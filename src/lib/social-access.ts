export function canViewConnectionList(input: {
  accountVisibility: "public" | "private";
  ownerId: string;
  viewerId: string;
  viewerFollowsOwner: boolean;
}) {
  return input.accountVisibility === "public"
    || input.ownerId === input.viewerId
    || input.viewerFollowsOwner;
}
