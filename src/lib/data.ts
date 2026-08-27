export type User = {
  name: string;
  handle: string;
  initials: string;
  color: string;
  verified?: boolean;
};

export type Territory = {
  id: string;
  name: string;
  district: string;
  area: string;
  distance: string;
  duration: string;
  color: string;
  variant: 1 | 2 | 3 | 4;
};

export type Post = {
  id: string;
  user: User;
  time: string;
  title: string;
  text: string;
  territory: Territory;
  likes: number;
  comments: number;
  photo?: "sunset" | "forest" | "city";
  photos?: Array<"sunset" | "forest" | "city">;
  imageSources?: string[];
  mapSnapshot?: string;
  mapView?: import("@/lib/map-preview").MapCameraState;
};

export const followingPosts: Post[] = [
  {
    id: "post-1",
    user: {
      name: "Defne Kaya",
      handle: "defnek",
      initials: "DK",
      color: "#ff8066",
      verified: true,
    },
    time: "12 dk",
    title: "Sabah sahil döngüsü",
    text: "Sabahın en iyi rotası. Sahili tamamen saramadım ama yarın kaldığım yerden devam! 🌊",
    territory: {
      id: "caddebostan-loop",
      name: "Caddebostan Sahil Turu",
      district: "Kadıköy, İstanbul",
      area: "0,84 km²",
      distance: "4,7 km",
      duration: "42 dk",
      color: "#ff8066",
      variant: 1,
    },
    likes: 284,
    comments: 18,
    photo: "sunset",
    photos: ["sunset", "city"],
  },
  {
    id: "post-2",
    user: {
      name: "Emir Arslan",
      handle: "emiruns",
      initials: "EA",
      color: "#8f7cff",
    },
    time: "1 sa",
    title: "Kuzguncuk morla buluştu",
    text: "Üç gündür peşinde olduğum döngü sonunda kapandı. Kuzguncuk artık biraz daha mor. 💜",
    territory: {
      id: "kuzguncuk-loop",
      name: "Kuzguncuk Büyük Tur",
      district: "Üsküdar, İstanbul",
      area: "1,26 km²",
      distance: "6,2 km",
      duration: "58 dk",
      color: "#8f7cff",
      variant: 2,
    },
    likes: 416,
    comments: 31,
  },
  {
    id: "post-3",
    user: {
      name: "Ceren Yılmaz",
      handle: "cerenstep",
      initials: "CY",
      color: "#48c9a5",
    },
    time: "3 sa",
    title: "Öğle arasında küçük bir imza",
    text: "Öğle arasında mini bir döngü. Küçük alanlar da büyük mutluluklar getiriyor.",
    territory: {
      id: "moda-loop",
      name: "Moda Cep Rotası",
      district: "Kadıköy, İstanbul",
      area: "0,18 km²",
      distance: "2,1 km",
      duration: "21 dk",
      color: "#48c9a5",
      variant: 3,
    },
    likes: 98,
    comments: 7,
    photo: "city",
  },
];

export const discoverPosts: Post[] = [
  {
    id: "discover-1",
    user: {
      name: "Selin Işık",
      handle: "selinmoves",
      initials: "Sİ",
      color: "#f3b83f",
      verified: true,
    },
    time: "8 dk",
    title: "Sis içinde yeni bir alan",
    text: "Belgrad Ormanı'nda sisli bir sabah ve yepyeni bir alan. Bu rota kesinlikle tekrar edilir.",
    territory: {
      id: "belgrad-loop",
      name: "Bentler Orman Rotası",
      district: "Sarıyer, İstanbul",
      area: "2,42 km²",
      distance: "8,4 km",
      duration: "1 sa 16 dk",
      color: "#f3b83f",
      variant: 4,
    },
    likes: 681,
    comments: 42,
    photo: "forest",
    photos: ["forest", "city", "sunset"],
  },
  {
    id: "discover-2",
    user: {
      name: "Bora Demir",
      handle: "borad",
      initials: "BD",
      color: "#4f8cff",
    },
    time: "44 dk",
    title: "Çankaya hafta sonu hedefi",
    text: "Ankara ekibi, Çankaya için hazır mıyız? Hafta sonu hedefimiz 20 km²!",
    territory: {
      id: "cankaya-loop",
      name: "Kuğulu–Seğmenler Hattı",
      district: "Çankaya, Ankara",
      area: "1,74 km²",
      distance: "7,1 km",
      duration: "1 sa 02 dk",
      color: "#4f8cff",
      variant: 2,
    },
    likes: 507,
    comments: 64,
  },
  {
    id: "discover-3",
    user: {
      name: "Melis Tan",
      handle: "meliswraps",
      initials: "MT",
      color: "#e864a9",
    },
    time: "2 sa",
    title: "Kordon'da pembe bir rota",
    text: "Kordon boyunca pembe bir imza bıraktım. İzmir sıralamasında ilk 50 yaklaşıyor!",
    territory: {
      id: "kordon-loop",
      name: "Kordon Gün Batımı",
      district: "Konak, İzmir",
      area: "0,96 km²",
      distance: "5,5 km",
      duration: "49 dk",
      color: "#e864a9",
      variant: 1,
    },
    likes: 392,
    comments: 23,
    photo: "sunset",
  },
];

export type RankEntry = {
  rank: number;
  name: string;
  handle: string;
  initials: string;
  color: string;
  area: number;
  change: number;
  city: string;
};

export const rankings: RankEntry[] = [
  { rank: 1, name: "Mert Aksoy", handle: "mertx", initials: "MA", color: "#ff8066", area: 48.7, change: 2, city: "Kadıköy" },
  { rank: 2, name: "Ece Güner", handle: "ecewrap", initials: "EG", color: "#8f7cff", area: 44.2, change: 0, city: "Beşiktaş" },
  { rank: 3, name: "Kerem Can", handle: "keremruns", initials: "KC", color: "#f3b83f", area: 39.8, change: 1, city: "Şişli" },
  { rank: 4, name: "Defne Kaya", handle: "defnek", initials: "DK", color: "#48c9a5", area: 36.4, change: -1, city: "Kadıköy" },
  { rank: 5, name: "Alp Duran", handle: "alpd", initials: "AD", color: "#4f8cff", area: 31.9, change: 3, city: "Üsküdar" },
  { rank: 6, name: "Zeynep Su", handle: "zeyneps", initials: "ZS", color: "#e864a9", area: 28.6, change: 1, city: "Beyoğlu" },
  { rank: 7, name: "Can Yalın", handle: "cyalin", initials: "CY", color: "#6acb74", area: 25.1, change: -2, city: "Ataşehir" },
  { rank: 8, name: "Deniz Aras", handle: "denizaras", initials: "DA", color: "#ff9f43", area: 22.8, change: 0, city: "Bakırköy" },
];
