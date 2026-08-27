export function desiredStateRequest(desired: boolean): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ desired }),
  };
}
