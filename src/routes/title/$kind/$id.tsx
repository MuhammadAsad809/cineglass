import { createFileRoute } from "@tanstack/react-router";
import { DetailView } from "@/components/cine/DetailView";

export const Route = createFileRoute("/title/$kind/$id")({
  component: TitleRoute,
});

function TitleRoute() {
  const { kind, id } = Route.useParams();
  return <DetailView kind={kind} id={id} />;
}
