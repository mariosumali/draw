#!/usr/bin/env python3
"""Train a 345-class QuickDraw classifier from stroke sequences.

This pipeline is intentionally separate from train_quickdraw.py, which trains
from pre-rendered 28x28 bitmaps. It downloads Google's NDJSON stroke files,
converts drawings into fixed-length sequence TFRecords, and trains from those
shards so each phase can resume after interruption.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import time
import urllib.parse
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import requests


PROJECT_ROOT = Path(__file__).resolve().parents[1]
PROMPTS_FILE = PROJECT_ROOT / "src/lib/game/prompts.ts"
DEFAULT_DATA_DIR = PROJECT_ROOT / "ml/data/strokes"
DEFAULT_ARTIFACT_DIR = PROJECT_ROOT / "ml/artifacts/quickdraw-strokes"
QUICKDRAW_CATEGORIES_URL = "https://raw.githubusercontent.com/googlecreativelab/quickdraw-dataset/master/categories.txt"
GCS_BASE_URL = "https://storage.googleapis.com/quickdraw_dataset/full"
FEATURE_COUNT = 5
SPLITS = ("train", "validation", "test")


@dataclass(frozen=True)
class DatasetConfig:
    classes: list[str]
    class_source: str
    include_unrecognized: bool
    max_points: int
    samples_per_class: int
    seed: int
    shard_size: int
    stroke_source: str
    test_ratio: float
    tfrecord_compression: str
    validation_ratio: float


@dataclass
class ClassManifest:
    label: int
    class_name: str
    counts: dict[str, int]
    files: dict[str, list[str]]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--class-source",
        choices=["quickdraw-345", "prompts"],
        default="quickdraw-345",
        help="Use all official classes or only the app prompt classes.",
    )
    parser.add_argument("--classes-file", type=Path, help="Optional newline-delimited class list.")
    parser.add_argument("--classes-url", default=QUICKDRAW_CATEGORIES_URL)
    parser.add_argument("--prompts-file", type=Path, default=PROMPTS_FILE)
    parser.add_argument(
        "--stroke-source",
        choices=["simplified", "raw"],
        default="simplified",
        help="QuickDraw NDJSON source. simplified keeps stroke order with fewer points; raw is much larger.",
    )
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    parser.add_argument("--artifact-dir", type=Path, default=DEFAULT_ARTIFACT_DIR)
    parser.add_argument("--processed-dir", type=Path, help="Optional processed-shard root.")
    parser.add_argument("--samples-per-class", type=int, default=5000)
    parser.add_argument("--max-points", type=int, default=256)
    parser.add_argument("--shard-size", type=int, default=4096)
    parser.add_argument("--epochs", type=int, default=40)
    parser.add_argument("--batch-size", type=int, default=512)
    parser.add_argument("--learning-rate", type=float, default=0.001)
    parser.add_argument("--validation-ratio", type=float, default=0.1)
    parser.add_argument("--test-ratio", type=float, default=0.1)
    parser.add_argument("--seed", type=int, default=1337)
    parser.add_argument("--download-workers", type=int, default=8)
    parser.add_argument(
        "--prepare-workers",
        type=int,
        default=max(1, min(8, os.cpu_count() or 1)),
        help="Number of classes to convert to TFRecord shards in parallel.",
    )
    parser.add_argument("--shuffle-buffer", type=int, default=50000)
    parser.add_argument(
        "--checkpoint-batches",
        type=int,
        default=2000,
        help="Also save a restart checkpoint every N train batches. Use 0 to disable.",
    )
    parser.add_argument(
        "--status-batches",
        type=int,
        default=100,
        help="Print training/evaluation progress every N batches. Use 0 to disable batch status.",
    )
    parser.add_argument("--architecture", choices=["tcn", "bigru"], default="tcn")
    parser.add_argument("--tcn-width", type=int, default=160)
    parser.add_argument("--rnn-width", type=int, default=192)
    parser.add_argument("--dropout", type=float, default=0.2)
    parser.add_argument(
        "--resume-from",
        default="latest",
        help='Checkpoint path, "latest" to resume newest epoch checkpoint, or "none" to start fresh.',
    )
    parser.add_argument("--skip-download", action="store_true")
    parser.add_argument("--skip-prepare", action="store_true")
    parser.add_argument("--download-only", action="store_true")
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument(
        "--include-unrecognized",
        action="store_true",
        help="Include QuickDraw examples where Google's recognizer marked recognized=false.",
    )
    parser.add_argument(
        "--tfrecord-compression",
        choices=["none", "gzip"],
        default="none",
        help="Use gzip to save disk at the cost of more input-pipeline CPU.",
    )
    parser.add_argument(
        "--max-eval-batches",
        type=int,
        default=0,
        help="Limit final evaluation batches. Use 0 to evaluate the full test set.",
    )
    parser.add_argument(
        "--export-saved-model",
        action="store_true",
        help="Also export a TensorFlow SavedModel under the artifact directory.",
    )
    parser.add_argument(
        "--evaluate-checkpoint",
        type=Path,
        help="Load an existing .keras checkpoint and write a per-class evaluation report without training.",
    )
    parser.add_argument(
        "--evaluate-split",
        choices=SPLITS,
        default="validation",
        help="Dataset split to use with --evaluate-checkpoint.",
    )
    parser.add_argument(
        "--evaluation-output",
        type=Path,
        help="Optional report path for --evaluate-checkpoint.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    validate_args(args)
    classes = read_classes(args)
    config = DatasetConfig(
        classes=classes,
        class_source=args.class_source,
        include_unrecognized=args.include_unrecognized,
        max_points=args.max_points,
        samples_per_class=args.samples_per_class,
        seed=args.seed,
        shard_size=args.shard_size,
        stroke_source=args.stroke_source,
        test_ratio=args.test_ratio,
        tfrecord_compression=args.tfrecord_compression,
        validation_ratio=args.validation_ratio,
    )

    args.data_dir.mkdir(parents=True, exist_ok=True)
    args.artifact_dir.mkdir(parents=True, exist_ok=True)
    write_json(args.artifact_dir / "classes.json", classes)
    write_json(args.artifact_dir / "dataset-config.json", config.__dict__)

    if not args.skip_download:
        download_classes(classes, args.data_dir, args.stroke_source, args.download_workers)
    else:
        log_status("Download phase: skipped by --skip-download.")
    if args.download_only:
        log_status("Download-only run complete.")
        return

    manifest_path = processed_manifest_path(args, config)
    if not args.skip_prepare:
        manifest_path = prepare_dataset(args, config)
    else:
        log_status(f"Prepare phase: skipped by --skip-prepare; using {manifest_path}.")
    if args.prepare_only:
        log_status("Prepare-only run complete.")
        return
    if not manifest_path.exists():
        raise FileNotFoundError(
            f"Processed manifest not found at {manifest_path}. Run without --skip-prepare first."
        )

    if args.evaluate_checkpoint:
        evaluate_checkpoint(args, config, manifest_path)
        return

    train(args, config, manifest_path)


def validate_args(args: argparse.Namespace) -> None:
    if args.samples_per_class < 1:
        raise ValueError("--samples-per-class must be positive.")
    if args.max_points < 16:
        raise ValueError("--max-points must be at least 16.")
    if args.shard_size < 1:
        raise ValueError("--shard-size must be positive.")
    if args.batch_size < 1:
        raise ValueError("--batch-size must be positive.")
    if args.prepare_workers < 1:
        raise ValueError("--prepare-workers must be positive.")
    if args.checkpoint_batches < 0:
        raise ValueError("--checkpoint-batches cannot be negative.")
    if args.status_batches < 0:
        raise ValueError("--status-batches cannot be negative.")
    if not 0 < args.validation_ratio < 0.5:
        raise ValueError("--validation-ratio must be between 0 and 0.5.")
    if not 0 < args.test_ratio < 0.5:
        raise ValueError("--test-ratio must be between 0 and 0.5.")
    if args.validation_ratio + args.test_ratio >= 0.8:
        raise ValueError("Validation and test ratios leave too little training data.")


def read_classes(args: argparse.Namespace) -> list[str]:
    if args.classes_file:
        return read_class_file(args.classes_file)
    if args.class_source == "quickdraw-345":
        return read_quickdraw_classes(args.classes_url)
    return read_prompt_classes(args.prompts_file)


def read_class_file(path: Path) -> list[str]:
    classes = [line.strip() for line in path.read_text(encoding="utf-8").splitlines()]
    return validate_classes([class_name for class_name in classes if class_name and not class_name.startswith("#")])


def read_quickdraw_classes(url: str) -> list[str]:
    response = requests.get(url, timeout=30)
    response.raise_for_status()
    return validate_classes([line.strip() for line in response.text.splitlines() if line.strip()])


def read_prompt_classes(path: Path) -> list[str]:
    source = path.read_text(encoding="utf-8")
    match = re.search(r"QUICK_DRAW_PROMPTS\s*=\s*\[(.*?)\]\s*as const", source, re.S)
    if not match:
        raise ValueError(f"Could not find QUICK_DRAW_PROMPTS in {path}")
    return validate_classes(re.findall(r'"([^"]+)"', match.group(1)))


def validate_classes(classes: list[str]) -> list[str]:
    if not classes:
        raise ValueError("Class list cannot be empty.")
    if len(set(classes)) != len(classes):
        raise ValueError("Class names must be unique.")
    return classes


def log_status(message: str) -> None:
    print(message, flush=True)


def format_duration(seconds: float) -> str:
    seconds = max(0, int(seconds))
    hours, remainder = divmod(seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    if hours:
        return f"{hours}h {minutes:02d}m {seconds:02d}s"
    if minutes:
        return f"{minutes}m {seconds:02d}s"
    return f"{seconds}s"


def format_bytes(byte_count: int) -> str:
    value = float(byte_count)
    for unit in ("B", "KB", "MB", "GB"):
        if value < 1024 or unit == "GB":
            return f"{value:.1f} {unit}" if unit != "B" else f"{int(value)} B"
        value /= 1024
    return f"{value:.1f} GB"


def estimate_remaining(elapsed: float, completed: int, remaining: int) -> str:
    if completed <= 0 or remaining <= 0:
        return "0s"
    return format_duration(elapsed / completed * remaining)


def percent(completed: int, total: int) -> str:
    if total <= 0:
        return "100.0%"
    return f"{completed / total * 100:.1f}%"


def format_counts(counts: dict[str, int]) -> str:
    return ", ".join(f"{split}={counts[split]:,}" for split in SPLITS)


def format_logs(logs: dict[str, object] | None) -> str:
    if not logs:
        return ""
    preferred_keys = ("loss", "top1", "top3", "val_loss", "val_top1", "val_top3", "lr", "learning_rate")
    parts: list[str] = []
    for key in preferred_keys:
        if key not in logs:
            continue
        try:
            parts.append(f"{key}={float(logs[key]):.4f}")
        except (TypeError, ValueError):
            continue
    return " ".join(parts)


def download_classes(classes: list[str], data_dir: Path, stroke_source: str, workers: int) -> None:
    pending = [
        class_name
        for class_name in classes
        if not is_complete_ndjson(class_path(data_dir, stroke_source, class_name))
    ]
    cached_count = len(classes) - len(pending)
    if not pending:
        log_status(f"Download phase: all QuickDraw stroke files are cached ({len(classes)}/{len(classes)}).")
        return

    worker_count = min(max(1, workers), len(pending))
    started_at = time.monotonic()
    log_status(
        "Download phase: "
        f"{cached_count}/{len(classes)} cached, {len(pending)} pending, "
        f"{worker_count} workers, source={stroke_source}."
    )
    with concurrent.futures.ThreadPoolExecutor(max_workers=worker_count) as executor:
        futures = {
            executor.submit(download_class, class_name, data_dir, stroke_source): class_name
            for class_name in pending
        }
        completed = 0
        for future in concurrent.futures.as_completed(futures):
            class_name = futures[future]
            try:
                byte_count = future.result()
            except Exception as error:
                raise RuntimeError(f"Failed to download {class_name}") from error
            completed += 1
            total_done = cached_count + completed
            elapsed = time.monotonic() - started_at
            log_status(
                "Download progress: "
                f"{total_done}/{len(classes)} ({percent(total_done, len(classes))}) "
                f"downloaded {class_name} ({format_bytes(byte_count)}); "
                f"elapsed {format_duration(elapsed)}, eta {estimate_remaining(elapsed, completed, len(pending) - completed)}."
            )


def download_class(class_name: str, data_dir: Path, stroke_source: str) -> int:
    destination = class_path(data_dir, stroke_source, class_name)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if is_complete_ndjson(destination):
        return destination.stat().st_size

    partial = destination.with_suffix(destination.suffix + ".part")
    if is_complete_ndjson(partial):
        partial.replace(destination)
        return destination.stat().st_size

    encoded_name = urllib.parse.quote(class_name, safe="")
    url = f"{GCS_BASE_URL}/{stroke_source}/{encoded_name}.ndjson"
    subprocess.run(
        [
            "curl",
            "--fail",
            "--location",
            "--silent",
            "--show-error",
            "--retry",
            "5",
            "--connect-timeout",
            "20",
            "--continue-at",
            "-",
            "--output",
            str(partial),
            url,
        ],
        check=True,
    )

    if not is_complete_ndjson(partial):
        raise IOError(f"Downloaded file for {class_name} is not valid NDJSON: {partial}")
    partial.replace(destination)
    return destination.stat().st_size


def is_complete_ndjson(path: Path) -> bool:
    if not path.exists() or path.stat().st_size == 0:
        return False

    try:
        with path.open("rb") as file:
            file.seek(-1, 2)
            if file.read(1) != b"\n":
                return False

        with path.open("r", encoding="utf-8") as file:
            for line in file:
                if line.strip():
                    json.loads(line)
                    return True
    except Exception:
        return False

    return False


def prepare_dataset(args: argparse.Namespace, config: DatasetConfig) -> Path:
    import tensorflow as tf

    processed_dir = processed_root(args, config)
    processed_dir.mkdir(parents=True, exist_ok=True)
    write_json(processed_dir / "dataset-config.json", config.__dict__)

    pending_classes: list[tuple[int, str]] = []
    cached_count = 0
    for label, class_name in enumerate(config.classes):
        marker = class_marker_path(processed_dir, label)
        existing = load_class_manifest(marker, processed_dir)
        if existing:
            cached_count += 1
            continue
        pending_classes.append((label, class_name))

    log_status(
        "Prepare phase: "
        f"{cached_count}/{len(config.classes)} classes already prepared, "
        f"{len(pending_classes)} pending."
    )
    if pending_classes:
        worker_count = min(args.prepare_workers, len(pending_classes))
        started_at = time.monotonic()
        log_status(f"Prepare phase: converting classes to TFRecords with {worker_count} workers.")
        with concurrent.futures.ThreadPoolExecutor(max_workers=worker_count) as executor:
            futures = {
                executor.submit(prepare_class, args, config, processed_dir, label, class_name, tf): (
                    label,
                    class_name,
                )
                for label, class_name in pending_classes
            }
            completed = 0
            for future in concurrent.futures.as_completed(futures):
                label, class_name = futures[future]
                try:
                    manifest = future.result()
                except Exception as error:
                    raise RuntimeError(f"Failed to prepare {class_name}") from error
                marker = class_marker_path(processed_dir, label)
                write_json(marker, class_manifest_to_json(manifest, processed_dir))
                write_global_manifest(processed_dir, config)
                completed += 1
                total_done = cached_count + completed
                elapsed = time.monotonic() - started_at
                log_status(
                    "Prepare progress: "
                    f"{total_done}/{len(config.classes)} ({percent(total_done, len(config.classes))}) "
                    f"prepared {class_name} ({format_counts(manifest.counts)}); "
                    f"elapsed {format_duration(elapsed)}, "
                    f"eta {estimate_remaining(elapsed, completed, len(pending_classes) - completed)}."
                )

    manifest_path = write_global_manifest(processed_dir, config)
    log_status(f"Prepare phase complete: wrote TFRecord manifest to {manifest_path}.")
    return manifest_path


def prepare_class(
    args: argparse.Namespace,
    config: DatasetConfig,
    processed_dir: Path,
    label: int,
    class_name: str,
    tf: object,
) -> ClassManifest:
    cleanup_class_shards(processed_dir, label)
    split_by_index = make_split_plan(
        config.samples_per_class,
        config.validation_ratio,
        config.test_ratio,
        config.seed + label,
    )
    writers = {
        split: ShardWriter(
            processed_dir=processed_dir,
            split=split,
            label=label,
            shard_size=config.shard_size,
            compression=config.tfrecord_compression,
            tf=tf,
        )
        for split in SPLITS
    }
    counts = {split: 0 for split in SPLITS}
    selected = 0
    source = class_path(args.data_dir, config.stroke_source, class_name)

    with source.open("r", encoding="utf-8") as file:
        for line in file:
            if selected >= config.samples_per_class:
                break
            payload = json.loads(line)
            if not config.include_unrecognized and payload.get("recognized") is False:
                continue

            sequence, length = drawing_to_sequence(payload.get("drawing"), config.max_points)
            if sequence is None:
                continue

            split = split_by_index[selected]
            writers[split].write(make_example(sequence, label, length, tf))
            counts[split] += 1
            selected += 1

    files: dict[str, list[str]] = {}
    for split, writer in writers.items():
        files[split] = writer.close()

    if selected < config.samples_per_class:
        log_status(f"Warning: {class_name} only produced {selected} usable examples.")

    return ClassManifest(label=label, class_name=class_name, counts=counts, files=files)


def make_split_plan(
    samples_per_class: int,
    validation_ratio: float,
    test_ratio: float,
    seed: int,
) -> np.ndarray:
    rng = np.random.default_rng(seed)
    split_by_index = np.full(samples_per_class, "train", dtype=object)
    indices = rng.permutation(samples_per_class)
    test_count = max(1, int(samples_per_class * test_ratio))
    validation_count = max(1, int(samples_per_class * validation_ratio))
    split_by_index[indices[:test_count]] = "test"
    split_by_index[indices[test_count : test_count + validation_count]] = "validation"
    return split_by_index


def drawing_to_sequence(drawing: object, max_points: int) -> tuple[np.ndarray | None, int]:
    strokes = normalize_strokes(drawing)
    if not strokes:
        return None, 0

    sequence_rows: list[list[float]] = []
    previous: tuple[float, float] | None = None

    for stroke in strokes:
        for point_index, (x, y) in enumerate(stroke):
            if len(sequence_rows) >= max_points - 1:
                break
            if previous is None:
                dx = 0.0
                dy = 0.0
            else:
                dx = x - previous[0]
                dy = y - previous[1]
            previous = (x, y)
            is_last_point = point_index == len(stroke) - 1
            sequence_rows.append(
                [
                    dx,
                    dy,
                    0.0 if is_last_point else 1.0,
                    1.0 if is_last_point else 0.0,
                    0.0,
                ]
            )
        if len(sequence_rows) >= max_points - 1:
            break

    if len(sequence_rows) < 2:
        return None, 0

    sequence_rows.append([0.0, 0.0, 0.0, 0.0, 1.0])
    length = len(sequence_rows)
    sequence = np.zeros((max_points, FEATURE_COUNT), dtype=np.float16)
    sequence[:length] = np.asarray(sequence_rows, dtype=np.float16)
    return sequence, length


def normalize_strokes(drawing: object) -> list[list[tuple[float, float]]]:
    if not isinstance(drawing, list):
        return []

    strokes: list[list[tuple[float, float]]] = []
    all_points: list[tuple[float, float]] = []
    for stroke in drawing:
        if not isinstance(stroke, list) or len(stroke) < 2:
            continue
        xs, ys = stroke[0], stroke[1]
        if not isinstance(xs, list) or not isinstance(ys, list):
            continue

        points: list[tuple[float, float]] = []
        for x, y in zip(xs, ys):
            try:
                point = (float(x), float(y))
            except (TypeError, ValueError):
                continue
            points.append(point)
            all_points.append(point)
        if points:
            strokes.append(points)

    if not all_points:
        return []

    xs = [point[0] for point in all_points]
    ys = [point[1] for point in all_points]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    size = max(max_x - min_x, max_y - min_y, 1.0)
    center_x = min_x + (max_x - min_x) / 2
    center_y = min_y + (max_y - min_y) / 2

    return [
        [((x - center_x) / size, (y - center_y) / size) for x, y in stroke]
        for stroke in strokes
    ]


def make_example(sequence: np.ndarray, label: int, length: int, tf: object) -> bytes:
    example = tf.train.Example(
        features=tf.train.Features(
            feature={
                "sequence": tf.train.Feature(bytes_list=tf.train.BytesList(value=[sequence.tobytes()])),
                "label": tf.train.Feature(int64_list=tf.train.Int64List(value=[label])),
                "length": tf.train.Feature(int64_list=tf.train.Int64List(value=[length])),
            }
        )
    )
    return example.SerializeToString()


class ShardWriter:
    def __init__(
        self,
        *,
        processed_dir: Path,
        split: str,
        label: int,
        shard_size: int,
        compression: str,
        tf: object,
    ) -> None:
        self.processed_dir = processed_dir
        self.split = split
        self.label = label
        self.shard_size = shard_size
        self.compression = compression
        self.tf = tf
        self.count_in_shard = 0
        self.shard_index = 0
        self.writer = None
        self.current_tmp: Path | None = None
        self.current_final: Path | None = None
        self.files: list[str] = []

    def write(self, example: bytes) -> None:
        if self.writer is None or self.count_in_shard >= self.shard_size:
            self._open_next()
        self.writer.write(example)
        self.count_in_shard += 1

    def close(self) -> list[str]:
        self._close_current()
        return self.files

    def _open_next(self) -> None:
        self._close_current()
        split_dir = self.processed_dir / self.split
        split_dir.mkdir(parents=True, exist_ok=True)
        filename = f"class-{self.label:03d}-{self.shard_index:04d}.tfrecord"
        self.current_final = split_dir / filename
        self.current_tmp = split_dir / f"{filename}.tmp"
        options = None
        if self.compression == "gzip":
            options = self.tf.io.TFRecordOptions(compression_type="GZIP")
        self.writer = self.tf.io.TFRecordWriter(str(self.current_tmp), options=options)
        self.count_in_shard = 0
        self.shard_index += 1

    def _close_current(self) -> None:
        if self.writer is None:
            return
        self.writer.close()
        self.writer = None
        if self.count_in_shard == 0:
            assert self.current_tmp is not None
            self.current_tmp.unlink(missing_ok=True)
            return
        assert self.current_tmp is not None
        assert self.current_final is not None
        self.current_tmp.replace(self.current_final)
        self.files.append(str(self.current_final.relative_to(self.processed_dir)))


def cleanup_class_shards(processed_dir: Path, label: int) -> None:
    for split in SPLITS:
        split_dir = processed_dir / split
        if not split_dir.exists():
            continue
        for path in split_dir.glob(f"class-{label:03d}-*.tfrecord*"):
            path.unlink()


def write_global_manifest(processed_dir: Path, config: DatasetConfig) -> Path:
    class_manifests: list[ClassManifest] = []
    for label, _class_name in enumerate(config.classes):
        marker = class_marker_path(processed_dir, label)
        manifest = load_class_manifest(marker, processed_dir)
        if manifest:
            class_manifests.append(manifest)

    counts = {split: sum(manifest.counts[split] for manifest in class_manifests) for split in SPLITS}
    files = {
        split: [
            file
            for manifest in class_manifests
            for file in manifest.files[split]
        ]
        for split in SPLITS
    }
    manifest_path = processed_dir / "dataset-manifest.json"
    write_json(
        manifest_path,
        {
            "complete": len(class_manifests) == len(config.classes),
            "classCount": len(config.classes),
            "preparedClassCount": len(class_manifests),
            "configHash": config_hash(config),
            "counts": counts,
            "files": files,
            "classes": config.classes,
            "classManifests": [
                class_manifest_to_json(manifest, processed_dir) for manifest in class_manifests
            ],
        },
    )
    return manifest_path


def load_class_manifest(path: Path, processed_dir: Path) -> ClassManifest | None:
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        manifest = ClassManifest(
            label=int(payload["label"]),
            class_name=str(payload["className"]),
            counts={split: int(payload["counts"][split]) for split in SPLITS},
            files={split: [str(file) for file in payload["files"][split]] for split in SPLITS},
        )
    except Exception:
        return None

    for files in manifest.files.values():
        for file in files:
            if not (processed_dir / file).exists():
                return None
    return manifest


def class_manifest_to_json(manifest: ClassManifest, _processed_dir: Path) -> dict[str, object]:
    return {
        "label": manifest.label,
        "className": manifest.class_name,
        "counts": manifest.counts,
        "files": manifest.files,
    }


def train(args: argparse.Namespace, config: DatasetConfig, manifest_path: Path) -> None:
    import tensorflow as tf

    log_status(f"Training phase: loading manifest from {manifest_path}.")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not manifest.get("complete"):
        raise ValueError(f"Processed manifest is incomplete: {manifest_path}")

    checkpoint_dir = args.artifact_dir / "checkpoints"
    checkpoint_dir.mkdir(parents=True, exist_ok=True)
    model, initial_epoch = load_or_build_model(args, config, checkpoint_dir, tf)
    train_dataset = make_dataset(args, config, manifest_path, "train", training=True, tf=tf)
    validation_dataset = make_dataset(args, config, manifest_path, "validation", training=False, tf=tf)
    train_count = int(manifest["counts"]["train"])
    validation_count = int(manifest["counts"]["validation"])
    test_count = int(manifest["counts"]["test"])
    steps_per_epoch = max(1, train_count // args.batch_size)
    validation_steps = math.ceil(validation_count / args.batch_size)
    test_steps = math.ceil(test_count / args.batch_size)
    log_status(
        "Training phase: "
        f"classes={len(config.classes)}, train={train_count:,}, validation={validation_count:,}, "
        f"test={test_count:,}, batch_size={args.batch_size}, "
        f"steps_per_epoch={steps_per_epoch:,}, validation_steps={validation_steps:,}, "
        f"epochs={initial_epoch + 1}-{args.epochs}."
    )

    callbacks = [
        make_training_status_callback(
            total_epochs=args.epochs,
            steps_per_epoch=steps_per_epoch,
            every_batches=args.status_batches,
        ),
        tf.keras.callbacks.BackupAndRestore(backup_dir=str(args.artifact_dir / "training-backup")),
        tf.keras.callbacks.ModelCheckpoint(
            filepath=str(checkpoint_dir / "epoch-{epoch:03d}.keras"),
            save_freq="epoch",
            verbose=1,
        ),
        tf.keras.callbacks.ModelCheckpoint(
            filepath=str(args.artifact_dir / "best.keras"),
            monitor="val_top3",
            mode="max",
            save_best_only=True,
            verbose=1,
        ),
        tf.keras.callbacks.CSVLogger(str(args.artifact_dir / "training-log.csv"), append=initial_epoch > 0),
        tf.keras.callbacks.ReduceLROnPlateau(
            monitor="val_loss",
            factor=0.5,
            patience=3,
            min_lr=1e-5,
        ),
    ]
    if args.checkpoint_batches:
        callbacks.append(
            make_batch_model_checkpoint(
                checkpoint_dir=checkpoint_dir,
                every_batches=args.checkpoint_batches,
            )
        )

    model.fit(
        train_dataset,
        validation_data=validation_dataset,
        epochs=args.epochs,
        initial_epoch=initial_epoch,
        steps_per_epoch=steps_per_epoch,
        validation_steps=validation_steps,
        callbacks=callbacks,
        verbose=0,
    )

    final_model_path = args.artifact_dir / "model.keras"
    log_status(f"Training phase complete: saving final model to {final_model_path}.")
    model.save(final_model_path)
    if args.export_saved_model:
        saved_model_dir = args.artifact_dir / "saved_model"
        if saved_model_dir.exists():
            shutil.rmtree(saved_model_dir)
        log_status(f"Export phase: writing SavedModel to {saved_model_dir}.")
        model.export(saved_model_dir)

    test_dataset = make_dataset(args, config, manifest_path, "test", training=False, tf=tf)
    log_status(f"Evaluation phase: evaluating {test_count:,} test examples across {test_steps:,} batches.")
    report = evaluate_model(
        model,
        test_dataset,
        config.classes,
        args.max_eval_batches,
        total_batches=test_steps,
        status_batches=args.status_batches,
    )
    write_json(args.artifact_dir / "evaluation.json", report)
    write_json(
        args.artifact_dir / "model-metadata.json",
        {
            "architecture": args.architecture,
            "classCount": len(config.classes),
            "dataset": f"full/{config.stroke_source}",
            "featureCount": FEATURE_COUNT,
            "inputShape": [1, config.max_points, FEATURE_COUNT],
            "license": "CC BY 4.0",
            "maxPoints": config.max_points,
            "samplesPerClass": config.samples_per_class,
            "source": "googlecreativelab/quickdraw-dataset",
            "strokeEncoding": ["dx", "dy", "pen_down", "pen_up", "pen_end"],
            "overall": report["overall"],
        },
    )
    log_status(f"Saved final model to {final_model_path}.")
    log_status(
        "Final evaluation: "
        f"samples={report['overall']['samples']:,}, "
        f"top1={report['overall']['top1_accuracy']:.4f}, "
        f"top3={report['overall']['top3_accuracy']:.4f}."
    )


def evaluate_checkpoint(args: argparse.Namespace, config: DatasetConfig, manifest_path: Path) -> None:
    import tensorflow as tf

    register_custom_layers(tf)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not manifest.get("complete"):
        raise ValueError(f"Processed manifest is incomplete: {manifest_path}")
    if not args.evaluate_checkpoint.exists():
        raise FileNotFoundError(f"Checkpoint not found: {args.evaluate_checkpoint}")

    split = args.evaluate_split
    sample_count = int(manifest["counts"][split])
    total_batches = math.ceil(sample_count / args.batch_size)
    output_path = args.evaluation_output or (
        args.artifact_dir / f"{split}-per-class-evaluation.json"
    )

    log_status(f"Evaluation phase: loading checkpoint {args.evaluate_checkpoint}.")
    model = tf.keras.models.load_model(args.evaluate_checkpoint)
    dataset = make_dataset(args, config, manifest_path, split, training=False, tf=tf)
    log_status(
        "Evaluation phase: "
        f"split={split}, samples={sample_count:,}, batch_size={args.batch_size}, "
        f"batches={total_batches:,}, output={output_path}."
    )
    report = evaluate_model(
        model,
        dataset,
        config.classes,
        args.max_eval_batches,
        total_batches=total_batches,
        status_batches=args.status_batches,
    )
    report["checkpoint"] = str(args.evaluate_checkpoint)
    report["split"] = split
    write_json(output_path, report)

    worst = sorted(
        report["per_class"].items(),
        key=lambda item: (item[1]["top3_accuracy"], item[1]["top1_accuracy"]),
    )[:10]
    log_status(
        "Evaluation complete: "
        f"samples={report['overall']['samples']:,}, "
        f"top1={report['overall']['top1_accuracy']:.4f}, "
        f"top3={report['overall']['top3_accuracy']:.4f}, "
        f"report={output_path}."
    )
    log_status(
        "Lowest top3 classes: "
        + ", ".join(
            f"{class_name}={metrics['top3_accuracy']:.3f}"
            for class_name, metrics in worst
        )
    )


def make_training_status_callback(total_epochs: int, steps_per_epoch: int, every_batches: int) -> object:
    import tensorflow as tf

    class TrainingStatus(tf.keras.callbacks.Callback):
        def __init__(self) -> None:
            super().__init__()
            self.epoch_started_at = 0.0
            self.train_started_at = 0.0
            self.current_epoch = 0

        def on_train_begin(self, logs: dict[str, object] | None = None) -> None:
            self.train_started_at = time.monotonic()
            log_status(
                "Training progress: "
                f"starting fit for {total_epochs} epochs, {steps_per_epoch:,} batches per epoch."
            )

        def on_epoch_begin(self, epoch: int, logs: dict[str, object] | None = None) -> None:
            self.current_epoch = epoch
            self.epoch_started_at = time.monotonic()
            log_status(f"Epoch {epoch + 1}/{total_epochs} started.")

        def on_train_batch_end(self, batch: int, logs: dict[str, object] | None = None) -> None:
            batch_number = batch + 1
            if every_batches <= 0 and batch_number < steps_per_epoch:
                return
            if every_batches > 0 and batch_number < steps_per_epoch and batch_number % every_batches != 0:
                return

            elapsed = time.monotonic() - self.epoch_started_at
            remaining_batches = max(0, steps_per_epoch - batch_number)
            metric_text = format_logs(logs)
            suffix = f" {metric_text}" if metric_text else ""
            log_status(
                "Training progress: "
                f"epoch {self.current_epoch + 1}/{total_epochs} "
                f"batch {batch_number:,}/{steps_per_epoch:,} ({percent(batch_number, steps_per_epoch)}); "
                f"elapsed {format_duration(elapsed)}, "
                f"epoch eta {estimate_remaining(elapsed, batch_number, remaining_batches)}.{suffix}"
            )

        def on_epoch_end(self, epoch: int, logs: dict[str, object] | None = None) -> None:
            elapsed = time.monotonic() - self.epoch_started_at
            metric_text = format_logs(logs)
            suffix = f" {metric_text}" if metric_text else ""
            log_status(f"Epoch {epoch + 1}/{total_epochs} complete in {format_duration(elapsed)}.{suffix}")

        def on_train_end(self, logs: dict[str, object] | None = None) -> None:
            elapsed = time.monotonic() - self.train_started_at
            log_status(f"Training progress: fit complete in {format_duration(elapsed)}.")

    return TrainingStatus()


def make_batch_model_checkpoint(checkpoint_dir: Path, every_batches: int) -> object:
    import tensorflow as tf

    class BatchModelCheckpoint(tf.keras.callbacks.Callback):
        def __init__(self) -> None:
            super().__init__()
            self.checkpoint_dir = checkpoint_dir
            self.every_batches = every_batches
            self.global_batch = 0
            self.current_epoch = 0

        def on_epoch_begin(self, epoch: int, logs: dict[str, object] | None = None) -> None:
            self.current_epoch = epoch

        def on_train_batch_end(self, batch: int, logs: dict[str, object] | None = None) -> None:
            self.global_batch += 1
            if self.global_batch % self.every_batches != 0:
                return

            checkpoint_path = self.checkpoint_dir / "batch-latest.keras"
            metadata_path = self.checkpoint_dir / "batch-latest.json"
            log_status(
                "Checkpoint save: "
                f"writing batch checkpoint at epoch {self.current_epoch + 1}, "
                f"batch {batch + 1}, global_batch {self.global_batch}."
            )
            self.model.save(checkpoint_path)
            write_json(
                metadata_path,
                {
                    "batch": int(batch),
                    "globalBatch": self.global_batch,
                    "epoch": int(self.current_epoch),
                    "logs": sanitize_logs(logs or {}),
                },
            )
            log_status(f"Checkpoint save: wrote {checkpoint_path} and {metadata_path}.")

    return BatchModelCheckpoint()


def sanitize_logs(logs: dict[str, object]) -> dict[str, float]:
    sanitized: dict[str, float] = {}
    for key, value in logs.items():
        try:
            sanitized[key] = float(value)
        except (TypeError, ValueError):
            continue
    return sanitized


def load_or_build_model(
    args: argparse.Namespace,
    config: DatasetConfig,
    checkpoint_dir: Path,
    tf: object,
) -> tuple[object, int]:
    register_custom_layers(tf)

    if args.resume_from == "none":
        return build_model(args, len(config.classes), config.max_points, tf), 0

    checkpoint_path: Path | None = None
    if args.resume_from == "latest":
        checkpoint_path = latest_checkpoint(checkpoint_dir)
    else:
        checkpoint_path = Path(args.resume_from)

    if checkpoint_path and checkpoint_path.exists():
        log_status(f"Resuming from {checkpoint_path}.")
        model = tf.keras.models.load_model(checkpoint_path)
        initial_epoch = parse_checkpoint_epoch(checkpoint_path)
        return model, initial_epoch

    log_status("No checkpoint found; starting a new stroke model.")
    return build_model(args, len(config.classes), config.max_points, tf), 0


def build_model(args: argparse.Namespace, class_count: int, max_points: int, tf: object) -> object:
    if args.architecture == "bigru":
        model = build_bigru_model(args, class_count, max_points, tf)
    else:
        model = build_tcn_model(args, class_count, max_points, tf)

    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=args.learning_rate),
        loss=tf.keras.losses.SparseCategoricalCrossentropy(),
        metrics=[
            tf.keras.metrics.SparseCategoricalAccuracy(name="top1"),
            tf.keras.metrics.SparseTopKCategoricalAccuracy(k=3, name="top3"),
        ],
    )
    return model


def build_tcn_model(args: argparse.Namespace, class_count: int, max_points: int, tf: object) -> object:
    masked_pooling = register_custom_layers(tf)
    inputs = tf.keras.Input(shape=(max_points, FEATURE_COUNT), name="strokes")
    x = tf.keras.layers.Dense(args.tcn_width, use_bias=False)(inputs)
    for dilation in (1, 2, 4, 8, 16, 32):
        residual = x
        x = tf.keras.layers.SeparableConv1D(
            args.tcn_width,
            kernel_size=5,
            padding="same",
            dilation_rate=dilation,
            use_bias=False,
        )(x)
        x = tf.keras.layers.BatchNormalization()(x)
        x = tf.keras.layers.Activation("gelu")(x)
        x = tf.keras.layers.Dropout(args.dropout)(x)
        x = tf.keras.layers.SeparableConv1D(
            args.tcn_width,
            kernel_size=3,
            padding="same",
            use_bias=False,
        )(x)
        x = tf.keras.layers.BatchNormalization()(x)
        x = tf.keras.layers.Add()([residual, x])
        x = tf.keras.layers.Activation("gelu")(x)

    x = masked_pooling()([x, inputs])
    x = tf.keras.layers.Dense(512, activation="gelu")(x)
    x = tf.keras.layers.Dropout(args.dropout)(x)
    outputs = tf.keras.layers.Dense(class_count, activation="softmax")(x)
    return tf.keras.Model(inputs=inputs, outputs=outputs, name="quickdraw_stroke_tcn")


def register_custom_layers(tf: object) -> object:
    existing = tf.keras.utils.get_registered_object("draw>MaskedGlobalPooling1D")
    if existing is not None:
        return existing

    @tf.keras.utils.register_keras_serializable(package="draw")
    class MaskedGlobalPooling1D(tf.keras.layers.Layer):
        def call(self, inputs: list[object]) -> object:
            values, mask_source = inputs
            mask = tf.cast(tf.reduce_any(tf.not_equal(mask_source, 0.0), axis=-1), values.dtype)
            mask = tf.expand_dims(mask, axis=-1)
            masked_sum = tf.reduce_sum(values * mask, axis=1)
            denominator = tf.maximum(tf.reduce_sum(mask, axis=1), tf.cast(1.0, values.dtype))
            average = masked_sum / denominator

            masked_values = tf.where(mask > 0, values, tf.cast(-1e9, values.dtype))
            maximum = tf.reduce_max(masked_values, axis=1)
            maximum = tf.where(denominator > 0, maximum, tf.zeros_like(maximum))
            return tf.concat([average, maximum], axis=-1)

        def compute_output_shape(self, input_shape: object) -> object:
            value_shape = input_shape[0]
            return value_shape[0], value_shape[-1] * 2

    return MaskedGlobalPooling1D


def build_bigru_model(args: argparse.Namespace, class_count: int, max_points: int, tf: object) -> object:
    inputs = tf.keras.Input(shape=(max_points, FEATURE_COUNT), name="strokes")
    x = tf.keras.layers.Masking(mask_value=0.0)(inputs)
    x = tf.keras.layers.Bidirectional(
        tf.keras.layers.GRU(args.rnn_width, return_sequences=True, dropout=args.dropout)
    )(x)
    x = tf.keras.layers.Bidirectional(
        tf.keras.layers.GRU(args.rnn_width, dropout=args.dropout)
    )(x)
    x = tf.keras.layers.Dense(512, activation="gelu")(x)
    x = tf.keras.layers.Dropout(args.dropout)(x)
    outputs = tf.keras.layers.Dense(class_count, activation="softmax")(x)
    return tf.keras.Model(inputs=inputs, outputs=outputs, name="quickdraw_stroke_bigru")


def make_dataset(
    args: argparse.Namespace,
    config: DatasetConfig,
    manifest_path: Path,
    split: str,
    *,
    training: bool,
    tf: object,
) -> object:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    processed_dir = manifest_path.parent
    files = [str(processed_dir / file) for file in manifest["files"][split]]
    if not files:
        raise ValueError(f"No {split} TFRecord files found in {manifest_path}")

    compression_type = "GZIP" if config.tfrecord_compression == "gzip" else None
    dataset = tf.data.Dataset.from_tensor_slices(files)
    if training:
        dataset = dataset.shuffle(len(files), seed=config.seed, reshuffle_each_iteration=True)
    dataset = dataset.interleave(
        lambda file: tf.data.TFRecordDataset(file, compression_type=compression_type),
        cycle_length=tf.data.AUTOTUNE,
        num_parallel_calls=tf.data.AUTOTUNE,
        deterministic=not training,
    )
    dataset = dataset.map(
        lambda example: parse_example(example, config.max_points, tf),
        num_parallel_calls=tf.data.AUTOTUNE,
    )
    if training:
        dataset = dataset.shuffle(args.shuffle_buffer, seed=config.seed, reshuffle_each_iteration=True)
        dataset = dataset.repeat()
    return dataset.batch(args.batch_size, drop_remainder=training).prefetch(tf.data.AUTOTUNE)


def parse_example(example: object, max_points: int, tf: object) -> tuple[object, object]:
    features = tf.io.parse_single_example(
        example,
        {
            "sequence": tf.io.FixedLenFeature([], tf.string),
            "label": tf.io.FixedLenFeature([], tf.int64),
            "length": tf.io.FixedLenFeature([], tf.int64),
        },
    )
    sequence = tf.io.decode_raw(features["sequence"], tf.float16)
    sequence = tf.reshape(sequence, [max_points, FEATURE_COUNT])
    sequence = tf.cast(sequence, tf.float32)
    return sequence, features["label"]


def evaluate_model(
    model: object,
    test_dataset: object,
    classes: list[str],
    max_eval_batches: int,
    *,
    total_batches: int,
    status_batches: int,
) -> dict[str, object]:
    class_count = len(classes)
    counts = np.zeros(class_count, dtype=np.int64)
    top1_counts = np.zeros(class_count, dtype=np.int64)
    top3_counts = np.zeros(class_count, dtype=np.int64)
    started_at = time.monotonic()
    planned_batches = min(total_batches, max_eval_batches) if max_eval_batches else total_batches

    for batch_index, (features, labels) in enumerate(test_dataset):
        if max_eval_batches and batch_index >= max_eval_batches:
            break
        probabilities = model.predict(features, verbose=0)
        labels_np = labels.numpy()
        top1 = np.argmax(probabilities, axis=1)
        top3 = np.argpartition(probabilities, -3, axis=1)[:, -3:]
        top1_correct = top1 == labels_np
        top3_correct = np.any(top3 == labels_np[:, None], axis=1)

        np.add.at(counts, labels_np, 1)
        np.add.at(top1_counts, labels_np[top1_correct], 1)
        np.add.at(top3_counts, labels_np[top3_correct], 1)
        batch_number = batch_index + 1
        should_report = batch_number == planned_batches or (
            status_batches > 0 and batch_number % status_batches == 0
        )
        if should_report:
            elapsed = time.monotonic() - started_at
            remaining_batches = max(0, planned_batches - batch_number)
            log_status(
                "Evaluation progress: "
                f"batch {batch_number:,}/{planned_batches:,} ({percent(batch_number, planned_batches)}); "
                f"elapsed {format_duration(elapsed)}, "
                f"eta {estimate_remaining(elapsed, batch_number, remaining_batches)}."
            )

    total = int(counts.sum())
    if total == 0:
        raise ValueError("No test samples were evaluated.")

    per_class = {}
    for label, class_name in enumerate(classes):
        if counts[label] == 0:
            continue
        per_class[class_name] = {
            "samples": int(counts[label]),
            "top1_accuracy": float(top1_counts[label] / counts[label]),
            "top3_accuracy": float(top3_counts[label] / counts[label]),
        }

    return {
        "classes": classes,
        "overall": {
            "samples": total,
            "top1_accuracy": float(top1_counts.sum() / total),
            "top3_accuracy": float(top3_counts.sum() / total),
        },
        "per_class": per_class,
    }


def processed_manifest_path(args: argparse.Namespace, config: DatasetConfig) -> Path:
    return processed_root(args, config) / "dataset-manifest.json"


def processed_root(args: argparse.Namespace, config: DatasetConfig) -> Path:
    root = args.processed_dir or args.artifact_dir / "processed"
    return root / config_hash(config)[:12]


def config_hash(config: DatasetConfig) -> str:
    payload = json.dumps(config.__dict__, sort_keys=True).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def class_path(data_dir: Path, stroke_source: str, class_name: str) -> Path:
    return data_dir / stroke_source / f"{class_name}.ndjson"


def class_marker_path(processed_dir: Path, label: int) -> Path:
    return processed_dir / "classes" / f"class-{label:03d}.json"


def latest_checkpoint(checkpoint_dir: Path) -> Path | None:
    checkpoints = list(checkpoint_dir.glob("epoch-*.keras"))
    batch_checkpoint = checkpoint_dir / "batch-latest.keras"
    if batch_checkpoint.exists():
        checkpoints.append(batch_checkpoint)
    if not checkpoints:
        return None
    return max(checkpoints, key=lambda path: path.stat().st_mtime)


def parse_checkpoint_epoch(path: Path) -> int:
    if path.name == "batch-latest.keras":
        metadata_path = path.with_suffix(".json")
        if metadata_path.exists():
            try:
                metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
                return int(metadata.get("epoch", 0))
            except Exception:
                return 0
        return 0

    match = re.search(r"epoch-(\d+)\.keras$", path.name)
    return int(match.group(1)) if match else 0


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
