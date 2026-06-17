const GITHUB_API_BASE = "https://api.github.com";

export function githubRepoFromUrl(url: string) {
  const match = url.match(/github\.com\/([^/?#]+\/[^/?#]+)/i);
  return match?.[1] ?? "context-labs/HALO";
}

export async function getGitHubRepoStars(repo: string) {
  try {
    const response = await fetch(`${GITHUB_API_BASE}/repos/${repo}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "HALO-App",
      },
    });
    if (!response.ok) return null;

    const data = (await response.json()) as { stargazers_count?: number };
    return typeof data.stargazers_count === "number" ? data.stargazers_count : null;
  } catch {
    return null;
  }
}
