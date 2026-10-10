import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { REGIONS } from "@/lib/cine/regions";
import { useCine } from "@/lib/cine/store";

export function SettingsModal() {
  const open = useCine((state) => state.settingsOpen);
  const setOpen = useCine((state) => state.setSettingsOpen);
  const region = useCine((state) => state.region);
  const setRegion = useCine((state) => state.setRegion);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-bg/75 backdrop-blur-xl" />
        <Dialog.Content className="modal-card glass fixed inset-x-4 top-16 z-[80] mx-auto max-w-lg rounded-3xl p-5 outline-none sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-xl font-semibold tracking-tight">Settings</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted">
                The TMDb catalog is enabled automatically. Choose a region for watch availability.
              </Dialog.Description>
            </div>
            <Dialog.Close className="btn btn-glass btn-icon" aria-label="Close settings">
              <X className="size-5" />
            </Dialog.Close>
          </div>

          <div className="mt-5 grid gap-2">
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

          <p className="mt-5 text-xs text-pretty text-muted">
            CineGlass uses TMDb for catalog data and watch links. It does not embed full movies; playback is limited to
            official trailers, motion stills, and links to legal providers. Atelier titles are original to this app.
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
