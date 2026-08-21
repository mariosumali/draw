import { spawn } from "node:child_process";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PYTHON_TIMEOUT_MS = 45_000;

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "SketchXAI dev inference is disabled in production." }, { status: 404 });
  }

  const payload = (await request.json()) as unknown;

  try {
    const result = await runSketchXai(payload);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "SketchXAI inference failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function runSketchXai(payload: unknown) {
  return new Promise<unknown>((resolve, reject) => {
    // The wrapper resolves the dev virtualenv at runtime. Keeping that symlink
    // out of this module prevents Turbopack from following it during builds.
    const child = spawn("sh", ["ml/run_sketchxai.sh"], {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("SketchXAI inference timed out."));
    }, PYTHON_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `SketchXAI exited with code ${code}.`));
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`SketchXAI returned invalid JSON: ${stdout}`));
      }
    });

    child.stdin.end(JSON.stringify(payload));
  });
}
