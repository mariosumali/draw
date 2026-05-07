#!/usr/bin/env python3
"""Train and export a QuickDraw classifier.

The script downloads Google QuickDraw numpy bitmap classes, trains a compact
CNN, writes an evaluation report, and exports TensorFlow.js assets that the app
can load from public/models/quickdraw.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import re
import subprocess
import urllib.parse
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import requests


PROJECT_ROOT = Path(__file__).resolve().parents[1]
PROMPTS_FILE = PROJECT_ROOT / "src/lib/game/prompts.ts"
DEFAULT_DATA_DIR = PROJECT_ROOT / "ml/data/numpy_bitmap"
DEFAULT_ARTIFACT_DIR = PROJECT_ROOT / "ml/artifacts/quickdraw"
DEFAULT_EXPORT_DIR = PROJECT_ROOT / "public/models/quickdraw"
GCS_BASE_URL = "https://storage.googleapis.com/quickdraw_dataset/full/numpy_bitmap"
QUICKDRAW_CATEGORIES_URL = "https://raw.githubusercontent.com/googlecreativelab/quickdraw-dataset/master/categories.txt"
IMAGE_SIZE = 28
IMAGE_PIXELS = IMAGE_SIZE * IMAGE_SIZE


@dataclass(frozen=True)
class Split:
    train: np.ndarray
    validation: np.ndarray
    test: np.ndarray


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--class-source",
        choices=["prompts", "quickdraw-345"],
        default="prompts",
        help="Use app prompts or the full official 345-class QuickDraw category list.",
    )
    parser.add_argument("--classes-file", type=Path, help="Optional newline-delimited class list.")
    parser.add_argument("--classes-url", default=QUICKDRAW_CATEGORIES_URL)
    parser.add_argument("--prompts-file", type=Path, default=PROMPTS_FILE)
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    parser.add_argument("--artifact-dir", type=Path, default=DEFAULT_ARTIFACT_DIR)
    parser.add_argument("--export-dir", type=Path, default=DEFAULT_EXPORT_DIR)
    parser.add_argument("--samples-per-class", type=int, default=5000)
    parser.add_argument("--epochs", type=int, default=18)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--validation-ratio", type=float, default=0.1)
    parser.add_argument("--test-ratio", type=float, default=0.1)
    parser.add_argument("--seed", type=int, default=1337)
    parser.add_argument("--download-workers", type=int, default=8)
    parser.add_argument("--skip-download", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    classes = read_classes(args)

    if len(classes) < 2:
        raise ValueError("At least two QuickDraw classes are required for training.")

    args.data_dir.mkdir(parents=True, exist_ok=True)
    args.artifact_dir.mkdir(parents=True, exist_ok=True)

    if not args.skip_download:
        download_classes(classes, args.data_dir, args.download_workers)

    rng = np.random.default_rng(args.seed)
    train_x, train_y, validation_x, validation_y, test_x, test_y = load_dataset(
        classes=classes,
        data_dir=args.data_dir,
        samples_per_class=args.samples_per_class,
        validation_ratio=args.validation_ratio,
        test_ratio=args.test_ratio,
        rng=rng,
    )

    import tensorflow as tf

    model = build_model(class_count=len(classes))
    augmentation = build_augmentation()
    train_dataset = make_train_dataset(train_x, train_y, args.batch_size, augmentation)
    validation_dataset = make_eval_dataset(validation_x, validation_y, args.batch_size)
    callbacks = [
        tf.keras.callbacks.EarlyStopping(
            monitor="val_sparse_categorical_accuracy",
            mode="max",
            patience=4,
            restore_best_weights=True,
        )
    ]

    model.fit(
        train_dataset,
        validation_data=validation_dataset,
        epochs=args.epochs,
        callbacks=callbacks,
    )

    report = evaluate_model(model, test_x, test_y, classes)
    write_json(args.artifact_dir / "evaluation.json", report)
    write_json(args.artifact_dir / "classes.json", classes)
    model.save(args.artifact_dir / "model.keras")

    export_tfjs_model(model, args.export_dir, classes, report, args)
    print(f"Exported TensorFlow.js model to {args.export_dir}")
    print(f"Top-1 accuracy: {report['overall']['top1_accuracy']:.3f}")
    print(f"Top-3 accuracy: {report['overall']['top3_accuracy']:.3f}")


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
    source = response.text
    return validate_classes([line.strip() for line in source.splitlines() if line.strip()])


def read_prompt_classes(path: Path) -> list[str]:
    source = path.read_text(encoding="utf-8")
    match = re.search(r"QUICK_DRAW_PROMPTS\s*=\s*\[(.*?)\]\s*as const", source, re.S)
    if not match:
        raise ValueError(f"Could not find QUICK_DRAW_PROMPTS in {path}")

    classes = re.findall(r'"([^"]+)"', match.group(1))
    return validate_classes(classes)


def validate_classes(classes: list[str]) -> list[str]:
    if not classes:
        raise ValueError("Class list cannot be empty.")
    if len(set(classes)) != len(classes):
        raise ValueError("Class names must be unique.")
    return classes


def download_classes(classes: list[str], data_dir: Path, workers: int) -> None:
    pending_classes: list[str] = []
    for class_name in classes:
        path = class_path(data_dir, class_name)
        if is_valid_class_file(path):
            continue
        path.unlink(missing_ok=True)
        pending_classes.append(class_name)

    if not pending_classes:
        print("All QuickDraw class files are already cached.")
        return

    print(f"Downloading {len(pending_classes)} QuickDraw class files with {workers} workers.")
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
        futures = {
            executor.submit(download_class, class_name, data_dir): class_name
            for class_name in pending_classes
        }
        for future in concurrent.futures.as_completed(futures):
            class_name = futures[future]
            future.result()
            print(f"Downloaded {class_name}")


def download_class(class_name: str, data_dir: Path) -> None:
    destination = class_path(data_dir, class_name)
    encoded_name = urllib.parse.quote(class_name, safe="")
    url = f"{GCS_BASE_URL}/{encoded_name}.npy"
    print(f"Starting {class_name}")
    download_file(url, destination)
    if not is_valid_class_file(destination):
        destination.unlink(missing_ok=True)
        raise IOError(f"Downloaded file for {class_name} is not a valid 28x28 numpy bitmap array.")


def is_valid_class_file(path: Path) -> bool:
    if not path.exists():
        return False

    try:
        with path.open("rb") as file:
            version = np.lib.format.read_magic(file)
            shape, _, dtype = np.lib.format._read_array_header(file, version)
            data_offset = file.tell()

        expected_size = data_offset + int(np.prod(shape)) * np.dtype(dtype).itemsize
        return path.stat().st_size == expected_size and int(np.prod(shape)) % IMAGE_PIXELS == 0
    except Exception:
        return False


def download_file(url: str, destination: Path) -> None:
    destination.unlink(missing_ok=True)
    try:
        subprocess.run(
            [
                "curl",
                "--fail",
                "--location",
                "--silent",
                "--show-error",
                "--retry",
                "3",
                "--connect-timeout",
                "20",
                "--max-time",
                "900",
                "--output",
                str(destination),
                url,
            ],
            check=True,
        )
    except Exception:
        destination.unlink(missing_ok=True)
        raise


def load_dataset(
    *,
    classes: list[str],
    data_dir: Path,
    samples_per_class: int,
    validation_ratio: float,
    test_ratio: float,
    rng: np.random.Generator,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    train_images: list[np.ndarray] = []
    train_labels: list[np.ndarray] = []
    validation_images: list[np.ndarray] = []
    validation_labels: list[np.ndarray] = []
    test_images: list[np.ndarray] = []
    test_labels: list[np.ndarray] = []

    for label, class_name in enumerate(classes):
        try:
            path = class_path(data_dir, class_name)
            raw_images = np.load(path)
        except Exception as error:
            path.unlink(missing_ok=True)
            raise ValueError(f"Unable to load cached QuickDraw data for {class_name}.") from error
        if raw_images.shape[-1] != IMAGE_PIXELS:
            raw_images = raw_images.reshape((-1, IMAGE_PIXELS))

        count = min(samples_per_class, raw_images.shape[0])
        selected_indices = rng.choice(raw_images.shape[0], size=count, replace=False)
        selected = raw_images[selected_indices].astype("float32") / 255.0
        selected = selected.reshape((-1, IMAGE_SIZE, IMAGE_SIZE, 1))

        split = split_indices(count, validation_ratio, test_ratio, rng)
        train_images.append(selected[split.train])
        validation_images.append(selected[split.validation])
        test_images.append(selected[split.test])

        train_labels.append(np.full(split.train.shape[0], label, dtype="int64"))
        validation_labels.append(np.full(split.validation.shape[0], label, dtype="int64"))
        test_labels.append(np.full(split.test.shape[0], label, dtype="int64"))

    train_x, train_y = shuffle_pair(np.concatenate(train_images), np.concatenate(train_labels), rng)
    validation_x, validation_y = shuffle_pair(
        np.concatenate(validation_images),
        np.concatenate(validation_labels),
        rng,
    )
    test_x, test_y = shuffle_pair(np.concatenate(test_images), np.concatenate(test_labels), rng)

    return train_x, train_y, validation_x, validation_y, test_x, test_y


def split_indices(
    count: int,
    validation_ratio: float,
    test_ratio: float,
    rng: np.random.Generator,
) -> Split:
    indices = rng.permutation(count)
    test_count = max(1, int(count * test_ratio))
    validation_count = max(1, int(count * validation_ratio))
    train_count = count - validation_count - test_count
    if train_count <= 0:
        raise ValueError("samples-per-class is too small for the requested splits.")

    return Split(
        train=indices[:train_count],
        validation=indices[train_count : train_count + validation_count],
        test=indices[train_count + validation_count :],
    )


def shuffle_pair(
    images: np.ndarray,
    labels: np.ndarray,
    rng: np.random.Generator,
) -> tuple[np.ndarray, np.ndarray]:
    indices = rng.permutation(images.shape[0])
    return images[indices], labels[indices]


def build_model(class_count: int) -> tf.keras.Model:
    import tensorflow as tf

    model = tf.keras.Sequential(
        [
            tf.keras.layers.Input(shape=(IMAGE_SIZE, IMAGE_SIZE, 1)),
            tf.keras.layers.Conv2D(32, 3, padding="same", activation="relu"),
            tf.keras.layers.BatchNormalization(),
            tf.keras.layers.Conv2D(32, 3, padding="same", activation="relu"),
            tf.keras.layers.MaxPooling2D(),
            tf.keras.layers.Dropout(0.15),
            tf.keras.layers.Conv2D(64, 3, padding="same", activation="relu"),
            tf.keras.layers.BatchNormalization(),
            tf.keras.layers.Conv2D(64, 3, padding="same", activation="relu"),
            tf.keras.layers.MaxPooling2D(),
            tf.keras.layers.Dropout(0.2),
            tf.keras.layers.Conv2D(128, 3, padding="same", activation="relu"),
            tf.keras.layers.GlobalAveragePooling2D(),
            tf.keras.layers.Dense(192, activation="relu"),
            tf.keras.layers.Dropout(0.25),
            tf.keras.layers.Dense(class_count, activation="softmax"),
        ]
    )
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=0.001),
        loss=tf.keras.losses.SparseCategoricalCrossentropy(),
        metrics=[tf.keras.metrics.SparseCategoricalAccuracy()],
    )
    return model


def build_augmentation() -> tf.keras.Sequential:
    import tensorflow as tf

    return tf.keras.Sequential(
        [
            tf.keras.layers.RandomTranslation(0.12, 0.12, fill_mode="constant"),
            tf.keras.layers.RandomZoom((-0.12, 0.08), fill_mode="constant"),
            tf.keras.layers.GaussianNoise(0.025),
        ]
    )


def make_train_dataset(
    images: np.ndarray,
    labels: np.ndarray,
    batch_size: int,
    augmentation: tf.keras.Sequential,
) -> tf.data.Dataset:
    import tensorflow as tf

    dataset = tf.data.Dataset.from_tensor_slices((images, labels))
    dataset = dataset.shuffle(min(images.shape[0], 10000)).batch(batch_size)
    dataset = dataset.map(
        lambda batch_images, batch_labels: (augmentation(batch_images, training=True), batch_labels),
        num_parallel_calls=tf.data.AUTOTUNE,
    )
    return dataset.prefetch(tf.data.AUTOTUNE)


def make_eval_dataset(images: np.ndarray, labels: np.ndarray, batch_size: int) -> tf.data.Dataset:
    import tensorflow as tf

    return tf.data.Dataset.from_tensor_slices((images, labels)).batch(batch_size).prefetch(tf.data.AUTOTUNE)


def evaluate_model(
    model: tf.keras.Model,
    test_x: np.ndarray,
    test_y: np.ndarray,
    classes: list[str],
) -> dict[str, object]:
    probabilities = model.predict(test_x, batch_size=256, verbose=0)
    top1 = np.argmax(probabilities, axis=1)
    top3 = np.argsort(probabilities, axis=1)[:, -3:]

    per_class: dict[str, dict[str, float | int]] = {}
    for label, class_name in enumerate(classes):
        mask = test_y == label
        if not np.any(mask):
            continue

        per_class[class_name] = {
            "samples": int(mask.sum()),
            "top1_accuracy": float(np.mean(top1[mask] == label)),
            "top3_accuracy": float(np.mean(np.any(top3[mask] == label, axis=1))),
        }

    return {
        "classes": classes,
        "overall": {
            "samples": int(test_y.shape[0]),
            "top1_accuracy": float(np.mean(top1 == test_y)),
            "top3_accuracy": float(np.mean(np.any(top3 == test_y[:, None], axis=1))),
        },
        "per_class": per_class,
    }


def export_tfjs_model(
    model: tf.keras.Model,
    export_dir: Path,
    classes: list[str],
    report: dict[str, object],
    args: argparse.Namespace,
) -> None:
    import tensorflowjs as tfjs

    export_dir.mkdir(parents=True, exist_ok=True)
    for path in export_dir.glob("group*-shard*of*.bin"):
        path.unlink()
    for filename in ("model.json", "classes.json", "model-metadata.json"):
        path = export_dir / filename
        if path.exists():
            path.unlink()

    tfjs.converters.save_keras_model(model, str(export_dir))
    patch_tfjs_model_json(export_dir / "model.json")
    write_json(export_dir / "classes.json", classes)
    write_json(
        export_dir / "model-metadata.json",
        {
            "source": "googlecreativelab/quickdraw-dataset",
            "dataset": "full/numpy_bitmap",
            "license": "CC BY 4.0",
            "classCount": len(classes),
            "classSource": args.class_source,
            "samplesPerClass": args.samples_per_class,
            "epochs": args.epochs,
            "inputShape": [1, IMAGE_SIZE, IMAGE_SIZE, 1],
            "overall": report["overall"],
        },
    )


def patch_tfjs_model_json(path: Path) -> None:
    model_json = json.loads(path.read_text(encoding="utf-8"))
    normalize_keras_config(model_json)
    normalize_weight_manifest(model_json)
    write_json(path, model_json)


def normalize_keras_config(value: object) -> None:
    if isinstance(value, dict):
        class_name = value.get("class_name")
        config = value.get("config")

        if class_name == "InputLayer" and isinstance(config, dict) and "batch_shape" in config:
            config["batch_input_shape"] = config.pop("batch_shape")

        if class_name == "DTypePolicy" and isinstance(config, dict) and "name" in config:
            value.clear()
            value.update({"__dtype_policy_name__": config["name"]})
            return

        for key, child in list(value.items()):
            normalize_keras_config(child)
            if isinstance(child, dict) and "__dtype_policy_name__" in child:
                value[key] = child["__dtype_policy_name__"]
    elif isinstance(value, list):
        for child in value:
            normalize_keras_config(child)


def normalize_weight_manifest(model_json: dict[str, object]) -> None:
    manifests = model_json.get("weightsManifest")
    if not isinstance(manifests, list):
        return

    for manifest in manifests:
        if not isinstance(manifest, dict):
            continue
        weights = manifest.get("weights")
        if not isinstance(weights, list):
            continue
        for weight in weights:
            if not isinstance(weight, dict):
                continue
            name = weight.get("name")
            if isinstance(name, str) and name.startswith("sequential/"):
                weight["name"] = name.removeprefix("sequential/")


def class_path(data_dir: Path, class_name: str) -> Path:
    return data_dir / f"{class_name}.npy"


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
