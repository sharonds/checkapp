import { jsonWithCors } from "@/lib/cors";
import { getMaskedConfig, writeAppConfig, getApiKeyStatus } from "@/lib/config";
import { guardLocalMutation } from "@/lib/guard-local";
import { NextRequest } from "next/server";

export async function GET() {
  try {
    return jsonWithCors({ config: getMaskedConfig(), apiKeys: getApiKeyStatus() });
  } catch (err) {
    return jsonWithCors({ error: "Failed to read config" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const blocked = guardLocalMutation(req);
  if (blocked) return blocked;
  try {
    const body = await req.json();
    writeAppConfig(body);
    return jsonWithCors({ ok: true });
  } catch (err) {
    return jsonWithCors({ error: "Failed to update config" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const blocked = guardLocalMutation(req);
  if (blocked) return blocked;
  try {
    const body = await req.json();
    writeAppConfig(body);
    return jsonWithCors({ ok: true });
  } catch (err) {
    return jsonWithCors({ error: "Failed to update config" }, { status: 500 });
  }
}
