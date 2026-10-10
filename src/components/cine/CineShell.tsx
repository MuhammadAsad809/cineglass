import { useEffect, type ReactNode } from "react";
import { Ambient } from "@/components/cine/Ambient";
import { Navbar } from "@/components/cine/Navbar";
import { PlayerModal } from "@/components/cine/PlayerModal";
import { SettingsModal } from "@/components/cine/SettingsModal";
import { useCine } from "@/lib/cine/store";

export function CineShell({ children }: { children: ReactNode }) {
  const setSettingsOpen = useCine((state) => state.setSettingsOpen);

  useEffect(() => {
    const unsub = useCine.persist.onFinishHydration(() => {
      useCine.setState({ hydrated: true });
    });
    void useCine.persist.rehydrate();
    if (useCine.persist.hasHydrated()) useCine.setState({ hydrated: true });
    return () => {
      unsub();
    };
  }, []);

  return (
    <>
      <Ambient />
      <Navbar />
      <div className="relative z-10 pt-4">{children}</div>
      <footer className="relative z-10 mx-auto max-w-3xl px-4 py-12 text-center text-xs text-pretty text-muted">
        Atelier titles are original to CineGlass. The live catalog, official trailers, and watch links come from
        TMDb when you add a key. This product uses the TMDb API but is not endorsed or certified by TMDb.{" "}
        <button type="button" className="underline underline-offset-2" onClick={() => setSettingsOpen(true)}>
          Settings
        </button>
      </footer>
      <PlayerModal />
      <SettingsModal />
    </>
  );
}
