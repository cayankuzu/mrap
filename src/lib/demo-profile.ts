import type { AppUser, PlayerSearchResult, PublicPlayer, SocialConnection } from "@/lib/models";

export const DEMO_PROFILE_STORAGE_KEY = "mrap:demo-profile:v1";

export const DEFAULT_DEMO_USER: AppUser = {
  id: "demo-user",
  email: "demo@mrap.local",
  username: "cayan",
  displayName: "Cayan Akın",
  initials: "CA",
  color: "#0D8BFF",
  pattern: 1,
  countryCode: "TR",
  cityId: "tr-istanbul",
  country: "Türkiye",
  city: "İstanbul",
  bio: "Şehri yürüyerek tanıyanlardan.",
  birthDate: "1995-06-12",
  accountVisibility: "public",
  locationVisibility: "private",
  avatarData: null,
  coverData: null,
  createdAt: "2026-05-01T10:00:00.000Z",
};

const DEMO_PLAYER_SEEDS = [
  { name: "Mert Aksoy", username: "mertx", initials: "MA", color: "#FF8066", countryCode: "TR", country: "Türkiye", city: "İstanbul", cityId: "tr-istanbul", areaKm2: 48.7 },
  { name: "Ece Güner", username: "ecewrap", initials: "EG", color: "#8F7CFF", countryCode: "TR", country: "Türkiye", city: "Ankara", cityId: "tr-ankara", areaKm2: 44.2 },
  { name: "Kerem Can", username: "keremruns", initials: "KC", color: "#F3B83F", countryCode: "TR", country: "Türkiye", city: "İzmir", cityId: "tr-izmir", areaKm2: 39.8 },
  { name: "Defne Kaya", username: "defnek", initials: "DK", color: "#48C9A5", countryCode: "TR", country: "Türkiye", city: "Bursa", cityId: "tr-bursa", areaKm2: 36.4 },
  { name: "Alp Duran", username: "alpd", initials: "AD", color: "#4F8CFF", countryCode: "DE", country: "Almanya", city: "Berlin", cityId: "de-berlin", areaKm2: 31.9 },
  { name: "Zeynep Su", username: "zeyneps", initials: "ZS", color: "#E864A9", countryCode: "FR", country: "Fransa", city: "Paris", cityId: "fr-paris", areaKm2: 28.6 },
  { name: "Can Yalın", username: "cyalin", initials: "CY", color: "#35B85A", countryCode: "GB", country: "Birleşik Krallık", city: "Londra", cityId: "gb-londra", areaKm2: 25.1 },
  { name: "Deniz Aras", username: "denizaras", initials: "DA", color: "#FF7A21", countryCode: "NL", country: "Hollanda", city: "Amsterdam", cityId: "nl-amsterdam", areaKm2: 22.8 },
  { name: "Selin Işık", username: "selinmoves", initials: "Sİ", color: "#F2B632", countryCode: "TR", country: "Türkiye", city: "İstanbul", cityId: "tr-istanbul", areaKm2: 18.4 },
  { name: "Bora Demir", username: "borad", initials: "BD", color: "#1677D2", countryCode: "TR", country: "Türkiye", city: "Ankara", cityId: "tr-ankara", areaKm2: 16.2 },
  { name: "Melis Tan", username: "meliswraps", initials: "MT", color: "#FF5D7D", countryCode: "TR", country: "Türkiye", city: "İzmir", cityId: "tr-izmir", areaKm2: 14.9 },
  { name: "Emir Arslan", username: "emiruns", initials: "EA", color: "#8F7CFF", countryCode: "DE", country: "Almanya", city: "Münih", cityId: "de-munih", areaKm2: 13.7 },
  { name: "Ceren Yılmaz", username: "cerenstep", initials: "CY", color: "#12CDB0", countryCode: "FR", country: "Fransa", city: "Lyon", cityId: "fr-lyon", areaKm2: 11.6 },
] as const;

export type DemoPlayer = PlayerSearchResult & Pick<PublicPlayer, "countryCode" | "cityId" | "country" | "bio" | "coverData" | "createdAt">;

export const DEMO_PLAYERS: DemoPlayer[] = DEMO_PLAYER_SEEDS.map((player, index) => ({
  id: `demo-player-${player.username}`,
  username: player.username,
  displayName: player.name,
  initials: player.initials,
  color: player.color,
  pattern: index % 4 + 1,
  countryCode: player.countryCode,
  cityId: player.cityId,
  country: player.country,
  city: player.city,
  bio: `${player.city} sokaklarında yeni alanların peşinde.`,
  accountVisibility: index === 2 || index === 7 ? "private" : "public",
  avatarData: null,
  coverData: null,
  createdAt: new Date(Date.UTC(2025, index % 12, index + 1)).toISOString(),
  followers: 1248 - index * 67,
  routes: Math.max(8, 54 - index * 3),
  areaKm2: player.areaKm2,
  relation: index < 5 ? "following" : "none",
}));

function connection(player: PlayerSearchResult): SocialConnection {
  return { user: player, relation: player.relation };
}

export const DEMO_FOLLOWERS = DEMO_PLAYERS.slice(0, 8).map(connection);
export const DEMO_FOLLOWING = DEMO_PLAYERS.filter((player) => player.relation === "following").map(connection);

export function getDemoPlayer(username: string) {
  return DEMO_PLAYERS.find((player) => player.username === username) ?? null;
}

export function getDemoConnections(username: string) {
  const available = DEMO_PLAYERS.filter((player) => player.username !== username);
  const offset = [...username].reduce((total, character) => total + character.codePointAt(0)!, 0) % available.length;
  const ordered = [...available.slice(offset), ...available.slice(0, offset)];
  return {
    followers: ordered.slice(0, 6).map(connection),
    following: [...ordered].reverse().slice(0, 4).map(connection),
  };
}
