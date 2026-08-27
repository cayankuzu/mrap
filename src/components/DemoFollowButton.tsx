"use client";

import { Check, Clock3, UserPlus } from "lucide-react";
import { useDemoProfile } from "@/components/DemoProfileProvider";
import { demoFollowRelation, type DemoFollowRelation } from "@/lib/demo-social-state";

export function DemoFollowButton({
  username,
  accountVisibility,
  initialRelation = "none",
}: {
  username: string;
  accountVisibility: "public" | "private";
  initialRelation?: DemoFollowRelation;
}) {
  const { social, toggleFollow } = useDemoProfile();
  const relation = demoFollowRelation(social, username, initialRelation);
  const label = relation === "following" ? "Takiptesin" : relation === "requested" ? "İstek gönderildi" : "Takip et";

  return <div className="follow-profile-control">
    <button
      type="button"
      className={`primary-button follow-profile-button${relation !== "none" ? " is-active" : ""}`}
      onClick={() => toggleFollow(username, accountVisibility, initialRelation)}
      aria-pressed={relation !== "none"}
    >
      {relation === "following" ? <Check size={17} /> : relation === "requested" ? <Clock3 size={17} /> : <UserPlus size={17} />}
      {label}
    </button>
  </div>;
}
