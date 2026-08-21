"use client";

import { useEffect, useState } from "react";

import { loadQuickDrawModel, QuickDrawModelAssetError } from "@/lib/quickdraw/model";
import { Ml5DoodleNetError } from "@/lib/quickdraw/ml5-doodlenet";

export type RecognizerLoadState = "loading" | "ready" | "error";

export function useRecognizerPreload() {
  const [loadState, setLoadState] = useState<RecognizerLoadState>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void loadQuickDrawModel()
      .then(() => {
        if (!cancelled) {
          setLoadState("ready");
          setError(null);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setLoadState("error");
          setError(recognizerErrorMessage(loadError));
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { loadState, error };
}

function recognizerErrorMessage(error: unknown) {
  if (error instanceof Ml5DoodleNetError) {
    return error.message;
  }

  if (error instanceof QuickDrawModelAssetError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "The doodle recognizer could not be loaded.";
}
