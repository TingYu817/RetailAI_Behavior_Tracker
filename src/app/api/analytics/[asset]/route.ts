import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

const ASSET_FILES: Record<string, { fileName: string; contentType: string }> = {
  tracking: {
    fileName: "annotated_tracking.mp4",
    contentType: "video/mp4",
  },
  heatmap: {
    fileName: "customer_heatmap.png",
    contentType: "image/png",
  },
};

async function getExistingFile(filePath: string) {
  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) return null;
    return { filePath, mtimeMs: stats.mtimeMs };
  } catch {
    return null;
  }
}

async function findAssetFile(assetKey: string, cameraName: string | null) {
  const asset = ASSET_FILES[assetKey];
  if (!asset) return null;

  const trackerRoot = path.resolve(process.cwd(), "..");
  const candidates: string[] = [];

  if (cameraName) {
    candidates.push(path.join(trackerRoot, "outputs", cameraName, asset.fileName));
    candidates.push(path.join(trackerRoot, `${cameraName}_results`, asset.fileName));
  } else {
    const outputsDir = path.join(trackerRoot, "outputs");
    try {
      const entries = await fs.readdir(outputsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          candidates.push(path.join(outputsDir, entry.name, asset.fileName));
        }
      }
    } catch {}

    try {
      const rootEntries = await fs.readdir(trackerRoot, { withFileTypes: true });
      for (const entry of rootEntries) {
        if (entry.isDirectory() && entry.name.endsWith("_results")) {
          candidates.push(path.join(trackerRoot, entry.name, asset.fileName));
        }
      }
    } catch {}
  }

  const existing = (await Promise.all(candidates.map(getExistingFile))).filter(
    (item): item is { filePath: string; mtimeMs: number } => item !== null
  );

  if (existing.length === 0) return null;
  existing.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return { ...existing[0], contentType: asset.contentType };
}

function parseRangeHeader(rangeHeader: string, fileSize: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match) return null;

  const startRaw = match[1];
  const endRaw = match[2];

  let start = startRaw ? Number(startRaw) : 0;
  let end = endRaw ? Number(endRaw) : fileSize - 1;

  if (!startRaw && endRaw) {
    const suffixLength = Number(endRaw);
    start = Math.max(fileSize - suffixLength, 0);
    end = fileSize - 1;
  }

  if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || end < start || start >= fileSize) {
    return null;
  }

  end = Math.min(end, fileSize - 1);
  return { start, end };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ asset: string }> }
) {
  const { asset } = await context.params;
  const camera = request.nextUrl.searchParams.get("camera");

  // 如果部署在 Vercel 上，因為無法讀取本機檔案，直接重新導向到 public 資料夾內的備用檔案
  if (process.env.VERCEL === "1") {
    const assetInfo = ASSET_FILES[asset];
    if (assetInfo) {
      return NextResponse.redirect(new URL(`/analytics/${assetInfo.fileName}`, request.url));
    }
  }

  const resolved = await findAssetFile(asset, camera);

  if (!resolved) {
    return NextResponse.json(
      { error: `Asset not found for ${asset}` },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }

  const stats = await fs.stat(resolved.filePath);
  const fileSize = stats.size;
  const rangeHeader = request.headers.get("range");
  const commonHeaders = {
    "Content-Type": resolved.contentType,
    "Cache-Control": "no-store, max-age=0",
    "Accept-Ranges": "bytes",
  };

  if (!rangeHeader) {
    const buffer = await fs.readFile(resolved.filePath);
    return new NextResponse(buffer, {
      headers: {
        ...commonHeaders,
        "Content-Length": String(fileSize),
      },
    });
  }

  const parsedRange = parseRangeHeader(rangeHeader, fileSize);
  if (!parsedRange) {
    return new NextResponse(null, {
      status: 416,
      headers: {
        ...commonHeaders,
        "Content-Range": `bytes */${fileSize}`,
      },
    });
  }

  const { start, end } = parsedRange;
  const handle = await fs.open(resolved.filePath, "r");
  try {
    const chunkSize = end - start + 1;
    const buffer = Buffer.alloc(chunkSize);
    await handle.read(buffer, 0, chunkSize, start);

    return new NextResponse(buffer, {
      status: 206,
      headers: {
        ...commonHeaders,
        "Content-Length": String(chunkSize),
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      },
    });
  } finally {
    await handle.close();
  }
}
