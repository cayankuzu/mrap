export function territoryProfilePath({ demo, username, currentUsername }: { demo: boolean; username: string; currentUsername: string }) {
  if (demo && username === currentUsername) return "/demo/profile";
  const encodedUsername = encodeURIComponent(username);
  return demo ? `/demo/users/${encodedUsername}` : `/users/${encodedUsername}`;
}
