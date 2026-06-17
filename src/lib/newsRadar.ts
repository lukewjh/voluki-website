import { newsRadarSources, type NewsRadarCategory } from "../data/newsRadarSources";

export type NewsRadarData = {
  categories: Array<NewsRadarCategory & { sourceCount: number }>;
  totalSources: number;
};

export const getNewsRadar = (): NewsRadarData => {
  const categories = newsRadarSources
    .filter((category) => category.enabled !== false)
    .map((category) => {
      const sources = category.sources.filter((source) => source.enabled !== false);

      return {
        ...category,
        sources,
        sourceCount: sources.length
      };
    });

  return {
    categories,
    totalSources: categories.reduce((total, category) => total + category.sourceCount, 0)
  };
};
