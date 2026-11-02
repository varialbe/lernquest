/** Link in die Wissenssammlung, z. B. von einem Konzept aus „Schwächen“ */
export const knowledgeHref = (concept: string, module?: string) => `/wissen?${new URLSearchParams({ ...(module ? { m: module.toUpperCase() } : {}), q: concept })}`;
