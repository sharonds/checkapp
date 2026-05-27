import { jsonWithCors } from "@/lib/cors";
import { getMaskedConfig, writeAppConfig, getApiKeyStatus, readAppConfig } from "@/lib/config";
import { guardLocalMutation, guardLocalReadOnly } from "@/lib/guard-local";
import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const blocked = guardLocalReadOnly(req);
  if (blocked) return blocked;
  try {
    const rawConfig = readAppConfig();
    const config = getMaskedConfig();
    const geminiApiKey =
      typeof rawConfig.geminiApiKey === "string" ? rawConfig.geminiApiKey : "";

    return jsonWithCors({
      config: {
        ...config,
        geminiApiKey: geminiApiKey ? "****" + geminiApiKey.slice(-4) : "",
      },
      apiKeys: {
        ...getApiKeyStatus(),
        gemini: !!(process.env.GEMINI_API_KEY || geminiApiKey),
      },
      capabilities: {
        geminiKeyConfigured: !!(process.env.GEMINI_API_KEY || geminiApiKey),
      },
    });
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
