import { redirect } from "next/navigation";

/**
 * The approval form moved to the Owner's review page in Step 8, next to the
 * application it decides on; old links (notifications, bookmarks) land there.
 */
export default async function ApproveWorkerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/workers/${id}/review`);
}
