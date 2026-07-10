#!/usr/bin/env python3
"""Download chart graphic SVGs exported from Figma MCP."""

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "images" / "charts"
MANIFEST = ROOT / "design" / "_charts-manifest.json"

URLS = {
    "ChartMotion-01.svg": "https://www.figma.com/api/mcp/asset/22527ba7-44bf-4204-b498-7ce415f7fa41",
    "ChartMotion-02.svg": "https://www.figma.com/api/mcp/asset/a7d386ab-0a94-478e-8760-9d6cb5f4d150",
    "ChartMotion-03.svg": "https://www.figma.com/api/mcp/asset/34afbc35-2a68-4f2f-b81a-026bb1fbed08",
    "Vertical-01.svg": "https://www.figma.com/api/mcp/asset/bd0f1f00-fc90-4d4f-9815-37ff015454b8",
    "Vertical-02.svg": "https://www.figma.com/api/mcp/asset/82f04e07-df89-43bb-95c5-cbe88b0cecb5",
    "Vertical-03.svg": "https://www.figma.com/api/mcp/asset/a248a4f3-c6f6-4370-b879-7ebc6e8e6e9b",
    "Vertical-04.svg": "https://www.figma.com/api/mcp/asset/cebbee40-6e83-4631-a7a2-fd7747e4c8a6",
    "Vertical-05.svg": "https://www.figma.com/api/mcp/asset/3a9bdbd1-0710-4f87-bc3a-3cc7828073e8",
    "Vertical-06.svg": "https://www.figma.com/api/mcp/asset/2fdaf60e-9955-4b8c-ac19-73a23d268bb8",
    "Vertical-07.svg": "https://www.figma.com/api/mcp/asset/b612cee5-7a86-4fe2-9854-27163842a14d",
    "Vertical-08.svg": "https://www.figma.com/api/mcp/asset/45ed5b68-c6b0-4e20-b84d-411c6aeae837",
    "Vertical-09.svg": "https://www.figma.com/api/mcp/asset/dbc89bc3-4020-4324-9761-51f37a08f440",
    "Vertical-10.svg": "https://www.figma.com/api/mcp/asset/856916e2-d48e-4a33-9f6c-e0f98c63b29d",
    "Vertical-11.svg": "https://www.figma.com/api/mcp/asset/9430b3bd-3d10-4254-bb2b-b56daa4ea531",
    "Vertical-12.svg": "https://www.figma.com/api/mcp/asset/8a382635-0860-440b-9c90-bdd3e184802b",
    "ProportionStatistics.svg": "https://www.figma.com/api/mcp/asset/928b4b1b-21bb-4f13-99e3-6b2c596c12d7",
    "Horizontal-01.svg": "https://www.figma.com/api/mcp/asset/cfd7b922-563e-4a3a-b094-e603a60fc251",
    "Horizontal-02.svg": "https://www.figma.com/api/mcp/asset/1513ec53-f8f9-4cf7-9abc-406e6b2e88de",
    "Horizontal-03.svg": "https://www.figma.com/api/mcp/asset/95da6de4-90a6-4bc3-b8e3-d0a2c30873ca",
    "Horizontal-04.svg": "https://www.figma.com/api/mcp/asset/786d9bc5-152f-4dc2-8db9-fd0906f1510d",
    "SemicircleChart.svg": "https://www.figma.com/api/mcp/asset/258512e2-1d0a-4b1f-9fa8-6e4aac925983",
    "DonutChart-01.svg": "https://www.figma.com/api/mcp/asset/951ed916-2243-44fb-8053-407f82dcd76a",
    "DonutChart-02.svg": "https://www.figma.com/api/mcp/asset/2f346a41-7984-4bf4-bca0-74437ebb8c1c",
    "DonutChart-03.svg": "https://www.figma.com/api/mcp/asset/9f0abeed-eee7-4081-b0b8-2f9854fab3c9",
    "DonutChart-04.svg": "https://www.figma.com/api/mcp/asset/4f09f616-4eda-49cd-9a36-86bb46c8cbaf",
    "DonutChart-05.svg": "https://www.figma.com/api/mcp/asset/1ee9c022-e5af-4d92-b871-0668c0fcaff8",
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(MANIFEST.read_text())

    for entry in manifest:
        filename = entry["file"]
        url = URLS.get(filename)
        if not url:
            raise SystemExit(f"Missing URL for {filename}")

        dest = OUT / filename
        subprocess.run(["curl", "-fsSL", url, "-o", str(dest)], check=True)
        print(f"OK {filename} ({dest.stat().st_size} bytes)")

    print(f"\nDownloaded {len(manifest)} chart SVGs to {OUT}")


if __name__ == "__main__":
    main()
