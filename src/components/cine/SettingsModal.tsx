import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, Eye, EyeOff, Loader2, X } from "lucide-react";
import { REGIONS } from "@/lib/cine/regions";
import { useCine } from "@/lib/cine/store";
import { formatTmdbError, testApiKey } from "@/lib/cine/tmdb";

export function SettingsModal() {
  const open = useCine((state) => state.settingsOpen);
  const setOpen = useCine((state) => state.setSettingsOpen);
  const apiKey = useCine((state) => state.apiKey);
  const setApiKey = useCine((state) => state.setApiKey);
  const region = useCine((state) => state.region);
  const setRegion = useCine((state) => state.setRegion);
  const [draft, setDraft] = useState(apiKey);
  const [reveal, setReveal] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(apiKey);
    setStatus(null);
    setOk(false);
    setReveal(false);
  }, [open, apiKey]);

  async function checkKey(key: string) {
    const trimmed = key.trim();
    if (trimmed.length < 16) {
      setOk(false);
      setStatus("Paste a TMDb v3 key or a v4 read token. Both are at least 16 characters.");
      return false;
    }
    setTesting(true);
    setStatus(null);
    try {
      await testApiKey(trimmed);
      setApiKey(trimmed);
      setOk(true);
      setStatus("Key accepted. Trending, movies, and series now load from TMDb.");
      return true;
    } catch (error) {
      setOk(false);
      setStatus(formatTmdbError(error));
      return false;
    } finally {
      setTesting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-bg/75 backdrop-blur-xl" />
        <Dialog.Content className="modal-card glass fixed inset-x-4 top-16 z-[80] mx-auto max-w-lg rounded-3xl p-5 outline-none sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-xl font-semibold tracking-tight">Settings</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted">
                Your key stays in this browser and is sent only to TMDb.
              </Dialog.Description>
            </div>
            <Dialog.Close className="btn btn-glass btn-icon" aria-label="Close settings">
              <X className="size-5" />
            </Dialog.Close>
          </div>

          <form
            className="mt-5 grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void checkKey(draft);
            }}
          >
            <div className="grid gap-2">
              <label htmlFor="tmdb-key" className="text-sm font-medium">
                TMDb API key
              </label>
              <div className="flex gap-2">
                <input
                  id="tmdb-key"
                  className="field"
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    setOk(false);
                  }}
                  type={reveal ? "text" : "password"}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="v3 key or v4 read token"
                />
                <button
                  type="button"
                  className="btn btn-glass btn-icon shrink-0"
                  aria-label={reveal ? "Hide key" : "Show key"}
                  onClick={() => setReveal((value) => !value)}
                >
                  {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              <p className="text-sm text-muted">
                <a
                  className="text-accent underline-offset-2 hover:underline"
                  href="https://www.themoviedb.org/settings/api"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Get a free key
                </a>{" "}
                from TMDb. It unlocks the live catalog, official YouTube trailers, and where-to-watch links.
              </p>
            </div>

            <div className="grid gap-2">
              <label htmlFor="region" className="text-sm font-medium">
                Watch region
              </label>
              <select
                id="region"
                className="field"
                value={region}
                onChange={(event) => setRegion(event.target.value)}
              >
                {REGIONS.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>

            {status ? (
              <p className="text-sm text-muted" role="status">
                {ok ? <Check className="mr-1 inline size-4 text-accent" /> : null}
                {status}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <button type="submit" className="btn btn-solid" disabled={testing}>
                {testing ? <Loader2 className="size-4 animate-spin" /> : null}
                Save and test
              </button>
              <button
                type="button"
                className="btn btn-glass"
                onClick={() => {
                  setDraft("");
                  setApiKey("");
                  setOk(false);
                  setStatus("Key removed. You're back on the Atelier shelf.");
                }}
              >
                Remove key
              </button>
            </div>
          </form>

          <p className="mt-5 text-xs text-pretty text-muted">
            CineGlass does not embed full movies. Playback is official trailers, motion stills, and links out to
            legal providers. Atelier titles are original to this app.
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
