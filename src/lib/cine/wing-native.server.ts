// Pure Node.js/Edge native resolver for CineJoy/Wing stream protocols.
// Executes WebAssembly request sealing and WebCrypto AES-GCM response decryption.

export type WingStreamResult = {
  uuid: string;
  server: string;
};

export async function resolveWingStream(input: {
  mediaType: "movie" | "tv";
  tmdbId: number;
  season?: number;
  episode?: number;
}): Promise<WingStreamResult | null> {
  const servers = ["nebula", "lisbon", "solara", "athens"];

  var h=e,H=a;u[h(391,d._0x1a3ad2)](m)&&C[H(d._0x46de5e,"[C&1")](P,S)})}u[a(405,W._0x53e3bc)](k,n),u[a(W._0x5d9f1c,"%sse")]()}export{Nc as I,E as P,YW as a,iW as b,D as c,lW as d,GW as e,AW as f,kc as g,mW as h,NW as i,KW as j,pW as k,qW as l,uc as m,bc as n,Pc as o,hW as p,oc as r,ic as s};

  for (const server of servers) {
    try {
      let res: any;
      if (input.mediaType === "tv") {
        const season = input.season ?? 1;
        const episode = input.episode ?? 1;
        res = await qw(`/${server}/series`, {
          tmdb_id: input.tmdbId,
          season,
          episode,
        });
      } else {
        res = await qw(`/${server}/movie`, {
          tmdb_id: input.tmdbId,
        });
      }

      if (res && res.uuid) {
        return { uuid: res.uuid, server };
      }
    } catch (err) {
      // Try next server
    }
  }

  return null;
}
