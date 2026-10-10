import type { Episode, SeasonMeta, StillFocus, Title, TitleSnapshot } from "@/lib/cine/types";
import { snapshotToTitle } from "@/lib/cine/types";

function episode(
  show: string,
  season: number,
  number: number,
  title: string,
  overview: string,
  focus: StillFocus,
  airDate: string,
): Episode {
  return {
    id: `${show}-s${season}e${number}`,
    number,
    title,
    overview,
    stillUrl: "/art/hero-cinema.jpg",
    stillFocus: focus,
    runtime: 48,
    airDate,
  };
}

function season(number: number, name: string, episodes: Episode[]): SeasonMeta {
  return {
    number,
    name,
    episodeCount: episodes.length,
    posterUrl: "/art/last-projectionist.jpg",
    episodes,
  };
}

export const ATELIER: Title[] = [
  {
    id: "atelier:last-projectionist",
    source: "atelier",
    mediaType: "tv",
    title: "The Last Projectionist",
    tagline: "The only building on the block that still dreams.",
    overview:
      "An art-deco cinema is scheduled for lofts. Its projectionist threads reels the audience didn't buy, and each screening changes one seat in the room. Season two asks what the film remembers when the house lights finally stay up.",
    posterUrl: "/art/last-projectionist.jpg",
    backdropUrl: "/art/hero-cinema.jpg",
    year: "2023",
    rating: 8.6,
    genres: ["Drama", "Mystery"],
    runtimeLabel: "48m",
    creditLine: "Created by June Pell",
    servers: [
      {
        id: "projectionist-trailer",
        name: "Trailer",
        kind: "trailer",
        src: "/trailers/projectionist.mp4",
      },
    ],
    cast: [
      { id: 1, name: "Arthur Lin", character: "The Projectionist", profileUrl: null },
      { id: 2, name: "Mara Ellison", character: "Nell, the critic", profileUrl: null },
      { id: 3, name: "Jonas Freire", character: "Owner", profileUrl: null },
      { id: 4, name: "Priya Raman", character: "Usher", profileUrl: null },
    ],
    seasons: [
      season(1, "The House", [
        episode(
          "last-projectionist",
          1,
          1,
          "House Lights",
          "The new owner wants apartments. The projector turns itself on and shows a film that isn't on the invoice.",
          "left",
          "2023-03-03",
        ),
        episode(
          "last-projectionist",
          1,
          2,
          "Changeover",
          "A reel from 1962 shows tonight's audience sitting exactly where they are, including one empty seat that isn't empty on the screen.",
          "center",
          "2023-03-10",
        ),
        episode(
          "last-projectionist",
          1,
          3,
          "Aperture",
          "A critic takes seat 14 and refuses to leave between features. She says the cuts are happening in the room, not the print.",
          "right",
          "2023-03-17",
        ),
        episode(
          "last-projectionist",
          1,
          4,
          "Carbon Arc",
          "The projectionist must choose between saving the building and finishing the only film he can see.",
          "top",
          "2023-03-24",
        ),
      ]),
      season(2, "The Borrowed Reel", [
        episode(
          "last-projectionist",
          2,
          1,
          "Seat Fourteen",
          "The cinema reopens for one private booking. Seat 14 is already warm when the doors unlock.",
          "center",
          "2023-11-02",
        ),
        episode(
          "last-projectionist",
          2,
          2,
          "Leader",
          "Countdown numbers appear on the screen between trailers, and the usher starts hearing them in the lobby.",
          "left",
          "2023-11-09",
        ),
        episode(
          "last-projectionist",
          2,
          3,
          "After the Credits",
          "The last screening ends. The beam doesn't. Someone in the booth is still changing reels.",
          "right",
          "2023-11-16",
        ),
      ]),
    ],
  },
  {
    id: "atelier:glass-harbor",
    source: "atelier",
    mediaType: "movie",
    title: "Glass Harbor",
    tagline: "The tide keeps a second city.",
    overview:
      "Harbor pilot Mara Ivers works a port that floods on a schedule nobody published. One night the water returns a woman who remembers tomorrow, and Mara has until dawn to decide which version of the city she is willing to lose.",
    posterUrl: "/art/glass-harbor.jpg",
    backdropUrl: "/art/glass-harbor-wide.jpg",
    year: "2024",
    rating: 8.4,
    genres: ["Crime", "Drama"],
    runtimeLabel: "1h 58m",
    creditLine: "Directed by June Pell",
    servers: [{ id: "harbor-trailer", name: "Trailer", kind: "trailer", src: "/trailers/harbor.mp4" }],
    cast: [
      { id: 1, name: "Elena Voss", character: "Mara Ivers", profileUrl: null },
      { id: 2, name: "Chris Adel", character: "The night pilot", profileUrl: null },
      { id: 3, name: "Naomi Berg", character: "Lena", profileUrl: null },
      { id: 4, name: "Victor Cho", character: "Harbor master", profileUrl: null },
    ],
  },
  {
    id: "atelier:salt-astronomer",
    source: "atelier",
    mediaType: "movie",
    title: "The Salt Astronomer",
    tagline: "The ocean left, and took the coordinates with it.",
    overview:
      "On a salt flat that used to be a sea, an astronomer maps stars that only appear in puddles. Her institute wants the charts. The sky wants them back.",
    posterUrl: "/art/salt-astronomer.jpg",
    backdropUrl: null,
    year: "2023",
    rating: 8.1,
    genres: ["Science Fiction", "Drama"],
    runtimeLabel: "2h 4m",
    creditLine: "Directed by Ira Solano",
    cast: [
      { id: 1, name: "Leila Haddad", character: "Dr. Amira Sen", profileUrl: null },
      { id: 2, name: "Owen Park", character: "Field assistant", profileUrl: null },
      { id: 3, name: "Ruth Keller", character: "Institute director", profileUrl: null },
    ],
  },
  {
    id: "atelier:velvet-static",
    source: "atelier",
    mediaType: "movie",
    title: "Velvet Static",
    tagline: "Requests from a frequency that signed off in 1978.",
    overview:
      "A late-night radio host starts playing songs phoned in from a station that no longer exists. The more she airs them, the more the city remembers a concert that never happened.",
    posterUrl: "/art/velvet-static.jpg",
    backdropUrl: null,
    year: "2025",
    rating: 7.9,
    genres: ["Music", "Mystery"],
    runtimeLabel: "1h 52m",
    creditLine: "Directed by Camille Ortega",
    cast: [
      { id: 1, name: "Sable Quinn", character: "Nia Cole", profileUrl: null },
      { id: 2, name: "Andre Walsh", character: "Engineer", profileUrl: null },
      { id: 3, name: "Hana Ito", character: "Caller", profileUrl: null },
    ],
  },
  {
    id: "atelier:north-of-violet",
    source: "atelier",
    mediaType: "movie",
    title: "North of Violet",
    tagline: "The town insists the streets have not moved.",
    overview:
      "A cartographer is hired to redraw a fjord village that slides north on every new map. The locals say she is measuring weather, not land. The shoreline disagrees.",
    posterUrl: "/art/north-of-violet.jpg",
    backdropUrl: null,
    year: "2021",
    rating: 8.0,
    genres: ["Mystery", "Thriller"],
    runtimeLabel: "1h 49m",
    creditLine: "Directed by Soren Vale",
    cast: [
      { id: 1, name: "Freya Holm", character: "Cartographer", profileUrl: null },
      { id: 2, name: "Mikkel Draug", character: "Ferryman", profileUrl: null },
      { id: 3, name: "Anouk Petit", character: "Archivist", profileUrl: null },
    ],
  },
  {
    id: "atelier:midnight-orchard",
    source: "atelier",
    mediaType: "movie",
    title: "Midnight Orchard",
    tagline: "One fence. Two harvests. A borrowed ladder.",
    overview:
      "Rival cider houses share a boundary and a harvest moon. Over one summer the night shifts, the trees lean, and neither family can bottle a vintage without the other.",
    posterUrl: "/art/midnight-orchard.jpg",
    backdropUrl: null,
    year: "2022",
    rating: 7.6,
    genres: ["Romance", "Drama"],
    runtimeLabel: "1h 46m",
    creditLine: "Directed by Helen Cho",
    cast: [
      { id: 1, name: "Mateo Ruiz", character: "Luis", profileUrl: null },
      { id: 2, name: "Eden Clarke", character: "Willa", profileUrl: null },
      { id: 3, name: "Rosa Bennett", character: "The aunt", profileUrl: null },
    ],
  },
  {
    id: "atelier:low-tide-letters",
    source: "atelier",
    mediaType: "movie",
    title: "Low Tide Letters",
    tagline: "Unsent, then uncovered.",
    overview:
      "A translator inherits a sack of letters her mother wrote to a lighthouse keeper and never posted. Each low tide leaves one more page in the sand, addressed in a hand she doesn't recognize as her own.",
    posterUrl: "/art/low-tide.jpg",
    backdropUrl: null,
    year: "2020",
    rating: 7.8,
    genres: ["Drama"],
    runtimeLabel: "1h 44m",
    creditLine: "Directed by Ada Moreau",
    cast: [
      { id: 1, name: "Inès Laurent", character: "The translator", profileUrl: null },
      { id: 2, name: "Tom Eriksen", character: "Keeper", profileUrl: null },
      { id: 3, name: "Greta Sol", character: "Mother, in memory", profileUrl: null },
    ],
  },
  {
    id: "atelier:paper-moons",
    source: "atelier",
    mediaType: "movie",
    title: "Paper Moons",
    tagline: "Every letter was addressed to the moon.",
    overview:
      "During a paper shortage, a boy folds the last Sunday comics into boats and sails them down a spillway, looking for the aunt who still writes to the sky. A small adventure about making a route when the map is gone.",
    posterUrl: "/art/paper-moons.jpg",
    backdropUrl: null,
    year: "2024",
    rating: 7.4,
    genres: ["Family", "Adventure"],
    runtimeLabel: "1h 38m",
    creditLine: "Directed by Noah Abebe",
    cast: [
      { id: 1, name: "Milo Grant", character: "Sam", profileUrl: null },
      { id: 2, name: "Amina Diallo", character: "Aunt June", profileUrl: null },
      { id: 3, name: "Pauline Orth", character: "Neighbor", profileUrl: null },
    ],
  },
  {
    id: "atelier:kinetic-saints",
    source: "atelier",
    mediaType: "movie",
    title: "Kinetic Saints",
    tagline: "The parcel is addressed to the rider.",
    overview:
      "In a walled city, couriers deliver memories instead of boxes. When one route comes back with his own name on it, the streets start rewriting who he has been.",
    posterUrl: "/art/kinetic-saints.jpg",
    backdropUrl: null,
    year: "2025",
    rating: 7.2,
    genres: ["Action", "Science Fiction"],
    runtimeLabel: "1h 41m",
    creditLine: "Directed by Ren Park",
    cast: [
      { id: 1, name: "Diego Marte", character: "Rider", profileUrl: null },
      { id: 2, name: "Yuki Sato", character: "Dispatcher", profileUrl: null },
      { id: 3, name: "Lila Mensah", character: "Archivist", profileUrl: null },
    ],
  },
];

const byId = new Map(ATELIER.map((title) => [title.id, title]));

export function getAtelier(id: string): Title | undefined {
  return byId.get(id);
}

export function searchAtelier(query: string): Title[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return ATELIER.filter((title) => {
    const haystack = [title.title, title.overview, title.tagline ?? "", ...title.genres]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  }).slice(0, 8);
}

export function atelierShelf(shelf: "trending" | "movies" | "tv"): Title[] {
  if (shelf === "movies") return ATELIER.filter((title) => title.mediaType === "movie");
  if (shelf === "tv") return ATELIER.filter((title) => title.mediaType === "tv");
  return ATELIER;
}

export function resolveTitle(snapshot: TitleSnapshot): Title {
  if (snapshot.source === "atelier" || snapshot.id.startsWith("atelier:")) {
    return getAtelier(snapshot.id) ?? snapshotToTitle(snapshot);
  }
  return snapshotToTitle(snapshot);
}
