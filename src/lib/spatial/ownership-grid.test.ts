import type { Polygon } from "geojson";
import { describe, expect, it } from "vitest";
import { TileOwnershipGrid, viewportToRegionIds } from "@/lib/spatial/ownership-grid";

function rectangle(west: number, south: number, east: number, north: number): Polygon {
  return {
    type: "Polygon",
    coordinates: [[
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ]],
  };
}

function boundsOf(polygon: Polygon) {
  const ring = polygon.coordinates[0];
  const longitudes = ring.map(([longitude]) => longitude);
  const latitudes = ring.map(([, latitude]) => latitude);
  return {
    west: Math.min(...longitudes),
    south: Math.min(...latitudes),
    east: Math.max(...longitudes),
    north: Math.max(...latitudes),
  };
}

describe("TileOwnershipGrid", () => {
  const grid = new TileOwnershipGrid({ cellZoom: 8, regionZoom: 5, maximumCandidateCells: 128 });

  it("tam hücre geometrisini yalnızca kendi canonical hücresine dönüştürür", async () => {
    const cellId = "8/148/95";

    expect(await grid.polygonToCells(grid.cellToGeometry(cellId))).toEqual([cellId]);
  });

  it("yalnızca ortak sınıra temas eden komşu hücreyi sahipliğe katmaz", async () => {
    const ownedCell = "8/100/100";
    const touchingNeighbor = "8/101/100";
    const cells = await grid.polygonToCells(grid.cellToGeometry(ownedCell));

    expect(cells).toContain(ownedCell);
    expect(cells).not.toContain(touchingNeighbor);
  });

  it("iki hücre arasındaki merkez içermeyen ince sliver alanı puanlamaz", async () => {
    const left = boundsOf(grid.cellToGeometry("8/100/100"));
    const right = boundsOf(grid.cellToGeometry("8/101/100"));
    const leftWidth = left.east - left.west;
    const rightWidth = right.east - right.west;
    const sliver = rectangle(
      left.east - leftWidth * 0.1,
      left.south,
      right.west + rightWidth * 0.1,
      left.north,
    );

    expect(await grid.polygonToCells(sliver)).toEqual([]);
  });

  it("çok hücreli sonuçları benzersiz ve deterministik sıralı üretir", async () => {
    const northWest = boundsOf(grid.cellToGeometry("8/100/100"));
    const southEast = boundsOf(grid.cellToGeometry("8/101/101"));
    const polygon = rectangle(northWest.west, southEast.south, southEast.east, northWest.north);
    const first = await grid.polygonToCells(polygon);
    const second = await grid.polygonToCells(polygon);

    expect(first).toEqual(["8/100/100", "8/100/101", "8/101/100", "8/101/101"]);
    expect(second).toEqual(first);
    expect(new Set(first).size).toBe(first.length);
  });

  it("tarih değiştirme meridyenini geçen çokgeni açıkça reddeder", async () => {
    const crossing: Polygon = {
      type: "Polygon",
      coordinates: [[
        [179, 10],
        [-179, 10],
        [-179, 11],
        [179, 11],
        [179, 10],
      ]],
    };

    await expect(grid.polygonToCells(crossing)).rejects.toThrow(/Tarih değiştirme meridyenini/);
  });

  it("Web Mercator dışındaki enlem ve dünya dışındaki boylamı reddeder", async () => {
    await expect(grid.polygonToCells(rectangle(29, 85, 30, 86))).rejects.toThrow(/Mercator/);
    await expect(grid.polygonToCells(rectangle(180, 40, 181, 41))).rejects.toThrow(/boylam/);
  });

  it("aday hücre sayısı güvenlik sınırını aşınca işlemi durdurur", async () => {
    const limited = new TileOwnershipGrid({ cellZoom: 8, regionZoom: 5, maximumCandidateCells: 1 });
    const first = boundsOf(limited.cellToGeometry("8/100/100"));
    const second = boundsOf(limited.cellToGeometry("8/101/100"));

    await expect(limited.polygonToCells(rectangle(first.west, first.south, second.east, first.north))).rejects.toThrow(
      /işlem sınırını/,
    );
  });

  it("delikli, kapanmamış ve yetersiz halkaları reddeder", async () => {
    const outer = rectangle(29, 40, 30, 41).coordinates[0];
    const hole = rectangle(29.2, 40.2, 29.4, 40.4).coordinates[0];
    const withHole: Polygon = { type: "Polygon", coordinates: [outer, hole] };
    const open: Polygon = { type: "Polygon", coordinates: [[[29, 40], [30, 40], [30, 41], [29, 41]]] };
    const tooShort: Polygon = { type: "Polygon", coordinates: [[[29, 40], [30, 40], [29, 40]]] };

    await expect(grid.polygonToCells(withHole)).rejects.toThrow(/tek halkalı/);
    await expect(grid.polygonToCells(open)).rejects.toThrow(/kapalı/);
    await expect(grid.polygonToCells(tooShort)).rejects.toThrow(/en az dört/);
  });

  it.each([
    "",
    "8//1",
    "08/1/1",
    "8/1.0/1",
    "0/0/0",
    "27/0/0",
    "8/-1/0",
    "8/256/0",
    "8/1/256",
    "8/1/1/2",
  ])("geçersiz canonical hücre kimliğini reddeder: %s", (cellId) => {
    expect(() => grid.cellToGeometry(cellId)).toThrow();
  });

  it("hücreyi üst region kimliğine deterministik eşler", () => {
    expect(grid.getRegionId("8/100/100")).toBe("5/12/12");
    expect(() => grid.getRegionId("4/8/8")).toThrow(/küçük olamaz/);
  });

  it("hücre alanını metre kare cinsinden hesaplar ve enleme göre küçültür", () => {
    const equatorArea = grid.calculateCellAreaM2("10/512/512");
    const highLatitudeArea = grid.calculateCellAreaM2("10/512/100");

    expect(equatorArea).toBeGreaterThan(0);
    expect(highLatitudeArea).toBeGreaterThan(0);
    expect(highLatitudeArea).toBeLessThan(equatorArea);
  });

  it.each([
    { cellZoom: 0, regionZoom: 1, maximumCandidateCells: 1 },
    { cellZoom: 27, regionZoom: 1, maximumCandidateCells: 1 },
    { cellZoom: 8.5, regionZoom: 1, maximumCandidateCells: 1 },
    { cellZoom: 8, regionZoom: 0, maximumCandidateCells: 1 },
    { cellZoom: 8, regionZoom: 9, maximumCandidateCells: 1 },
    { cellZoom: 8, regionZoom: 5, maximumCandidateCells: 0 },
  ])("geçersiz grid yapılandırmasını reddeder: $cellZoom/$regionZoom/$maximumCandidateCells", (options) => {
    expect(() => new TileOwnershipGrid(options)).toThrow();
  });
});

describe("viewportToRegionIds", () => {
  it("viewport regionlarını benzersiz, sıralı ve üst sınırla üretir", () => {
    const result = viewportToRegionIds([28, 40, 31, 42], 8, 7);

    expect(result).toEqual(result.toSorted());
    expect(new Set(result).size).toBe(result.length);
    expect(result).toHaveLength(7);
  });

  it.each([
    [[Number.NaN, 40, 30, 41], 8, 64],
    [[30, 40, 29, 41], 8, 64],
    [[29, 42, 30, 41], 8, 64],
    [[-180, 40, 1, 41], 8, 64],
    [[29, 85, 30, 86], 8, 64],
    [[29, 40, 30, 41], 0, 64],
    [[29, 40, 30, 41], 8.5, 64],
    [[29, 40, 30, 41], 8, 0],
  ] as const)("geçersiz viewport girdisinde boş sonuç döndürür", (bounds, zoom, limit) => {
    expect(viewportToRegionIds([...bounds], zoom, limit)).toEqual([]);
  });
});
