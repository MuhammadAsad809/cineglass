import { createFileRoute } from "@tanstack/react-router";
import { Browse } from "@/components/cine/Browse";
import { parseBrowseSearch } from "@/lib/cine/types";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>) => parseBrowseSearch(search),
  component: Home,
});

function Home() {
  const { shelf, library } = Route.useSearch();
  return <Browse shelf={shelf} library={library} />;
}
