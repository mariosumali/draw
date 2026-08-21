#!/usr/bin/env python3
"""Evaluate a QuickDraw stroke checkpoint with per-class metrics."""

from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path

import numpy as np

from train_quickdraw_strokes import (
    DEFAULT_ARTIFACT_DIR,
    SPLITS,
    DatasetConfig,
    config_hash,
    estimate_remaining,
    format_duration,
    latest_checkpoint,
    log_status,
    make_dataset,
    percent,
    register_custom_layers,
    write_json,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact-dir", type=Path, default=DEFAULT_ARTIFACT_DIR)
    parser.add_argument("--dataset-config", type=Path, help="Path to dataset-config.json.")
    parser.add_argument(
        "--processed-dir",
        type=Path,
        help="Processed dataset directory containing dataset-manifest.json.",
    )
    parser.add_argument(
        "--checkpoint",
        default="latest",
        help='Checkpoint path, "latest" for newest checkpoint, or "best" for best.keras.',
    )
    parser.add_argument("--split", choices=SPLITS, default="validation")
    parser.add_argument("--batch-size", type=int, default=512)
    parser.add_argument("--max-batches", type=int, default=0)
    parser.add_argument("--status-batches", type=int, default=100)
    parser.add_argument("--top-confusions", type=int, default=5)
    parser.add_argument("--output", type=Path, help="Output JSON report path.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.batch_size < 1:
        raise ValueError("--batch-size must be positive.")
    if args.max_batches < 0:
        raise ValueError("--max-batches cannot be negative.")
    if args.status_batches < 0:
        raise ValueError("--status-batches cannot be negative.")
    if args.top_confusions < 0:
        raise ValueError("--top-confusions cannot be negative.")

    import tensorflow as tf

    config = read_dataset_config(args.dataset_config or args.artifact_dir / "dataset-config.json")
    manifest_path = resolve_manifest_path(args, config)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not manifest.get("complete"):
        raise ValueError(f"Processed manifest is incomplete: {manifest_path}")

    checkpoint_path = resolve_checkpoint(args)
    output_path = args.output or args.artifact_dir / f"{args.split}-per-class-evaluation.json"

    register_custom_layers(tf)
    log_status(f"Per-class evaluation: loading checkpoint {checkpoint_path}.")
    model = tf.keras.models.load_model(checkpoint_path)

    sample_count = int(manifest["counts"][args.split])
    total_batches = math.ceil(sample_count / args.batch_size)
    dataset = make_dataset(args, config, manifest_path, args.split, training=False, tf=tf)
    log_status(
        "Per-class evaluation: "
        f"split={args.split}, samples={sample_count:,}, batch_size={args.batch_size}, "
        f"batches={total_batches:,}, output={output_path}."
    )

    report = evaluate_per_class(
        model=model,
        dataset=dataset,
        classes=config.classes,
        max_batches=args.max_batches,
        total_batches=total_batches,
        status_batches=args.status_batches,
        top_confusions=args.top_confusions,
    )
    report["checkpoint"] = str(checkpoint_path)
    report["split"] = args.split
    report["manifest"] = str(manifest_path)
    write_json(output_path, report)

    log_status(
        "Per-class evaluation complete: "
        f"samples={report['overall']['samples']:,}, "
        f"top1={report['overall']['top1_accuracy']:.4f}, "
        f"top3={report['overall']['top3_accuracy']:.4f}, "
        f"report={output_path}."
    )
    worst = sorted(
        report["per_class"].items(),
        key=lambda item: (item[1]["top3_accuracy"], item[1]["top1_accuracy"]),
    )[:10]
    log_status(
        "Lowest top3 classes: "
        + ", ".join(
            f"{class_name}={metrics['top3_accuracy']:.3f}"
            for class_name, metrics in worst
        )
    )


def read_dataset_config(path: Path) -> DatasetConfig:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return DatasetConfig(
        classes=[str(class_name) for class_name in payload["classes"]],
        class_source=str(payload["class_source"]),
        include_unrecognized=bool(payload["include_unrecognized"]),
        max_points=int(payload["max_points"]),
        samples_per_class=int(payload["samples_per_class"]),
        seed=int(payload["seed"]),
        shard_size=int(payload["shard_size"]),
        stroke_source=str(payload["stroke_source"]),
        test_ratio=float(payload["test_ratio"]),
        tfrecord_compression=str(payload["tfrecord_compression"]),
        validation_ratio=float(payload["validation_ratio"]),
    )


def resolve_manifest_path(args: argparse.Namespace, config: DatasetConfig) -> Path:
    if args.processed_dir:
        return args.processed_dir / "dataset-manifest.json"
    return args.artifact_dir / "processed" / config_hash(config)[:12] / "dataset-manifest.json"


def resolve_checkpoint(args: argparse.Namespace) -> Path:
    if args.checkpoint == "latest":
        checkpoint = latest_checkpoint(args.artifact_dir / "checkpoints")
        if checkpoint is None:
            raise FileNotFoundError(f"No checkpoints found under {args.artifact_dir / 'checkpoints'}")
        return checkpoint
    if args.checkpoint == "best":
        return args.artifact_dir / "best.keras"
    return Path(args.checkpoint)


def evaluate_per_class(
    *,
    model: object,
    dataset: object,
    classes: list[str],
    max_batches: int,
    total_batches: int,
    status_batches: int,
    top_confusions: int,
) -> dict[str, object]:
    class_count = len(classes)
    counts = np.zeros(class_count, dtype=np.int64)
    top1_counts = np.zeros(class_count, dtype=np.int64)
    top3_counts = np.zeros(class_count, dtype=np.int64)
    confusion = np.zeros((class_count, class_count), dtype=np.int64)
    started_at = time.monotonic()
    planned_batches = min(total_batches, max_batches) if max_batches else total_batches

    for batch_index, (features, labels) in enumerate(dataset):
        if max_batches and batch_index >= max_batches:
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
        np.add.at(confusion, (labels_np, top1), 1)

        batch_number = batch_index + 1
        should_report = batch_number == planned_batches or (
            status_batches > 0 and batch_number % status_batches == 0
        )
        if should_report:
            elapsed = time.monotonic() - started_at
            remaining_batches = max(0, planned_batches - batch_number)
            log_status(
                "Per-class evaluation progress: "
                f"batch {batch_number:,}/{planned_batches:,} ({percent(batch_number, planned_batches)}); "
                f"elapsed {format_duration(elapsed)}, "
                f"eta {estimate_remaining(elapsed, batch_number, remaining_batches)}."
            )

    total = int(counts.sum())
    if total == 0:
        raise ValueError("No evaluation samples were processed.")

    per_class = {}
    for label, class_name in enumerate(classes):
        if counts[label] == 0:
            continue
        row = confusion[label].copy()
        row[label] = 0
        confusion_indices = np.argsort(row)[::-1][:top_confusions]
        per_class[class_name] = {
            "samples": int(counts[label]),
            "top1_accuracy": float(top1_counts[label] / counts[label]),
            "top3_accuracy": float(top3_counts[label] / counts[label]),
            "top1_confusions": [
                {
                    "label": classes[int(index)],
                    "count": int(row[index]),
                    "rate": float(row[index] / counts[label]),
                }
                for index in confusion_indices
                if row[index] > 0
            ],
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


if __name__ == "__main__":
    main()
