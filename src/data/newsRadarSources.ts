export type NewsRadarSource = {
  id: string;
  name: string;
  url: string;
  language?: "zh" | "en" | "mixed";
  enabled?: boolean;
};

export type NewsRadarCategory = {
  id: string;
  name: string;
  description: string;
  enabled?: boolean;
  sources: NewsRadarSource[];
};

export const newsRadarSources: NewsRadarCategory[] = [
  {
    id: "ai",
    name: "AI",
    description: "AI labs, builders, product updates and research notes.",
    enabled: true,
    sources: [
      {
        id: "simon-willison",
        name: "Simon Willison",
        url: "https://simonwillison.net/",
        language: "en",
        enabled: true
      },
      {
        id: "openai",
        name: "OpenAI",
        url: "https://openai.com/news/",
        language: "en",
        enabled: true
      },
      {
        id: "anthropic",
        name: "Anthropic",
        url: "https://www.anthropic.com/news",
        language: "en",
        enabled: true
      },
      {
        id: "latent-space",
        name: "Latent Space",
        url: "https://www.latent.space/",
        language: "en",
        enabled: true
      },
      {
        id: "oreilly",
        name: "O'Reilly",
        url: "https://www.oreilly.com/radar/",
        language: "en",
        enabled: true
      }
    ]
  },
  {
    id: "news",
    name: "News",
    description: "Selected news and thinking sources for quick reading.",
    enabled: true,
    sources: [
      {
        id: "hacker-news",
        name: "Hacker News",
        url: "https://news.ycombinator.com/",
        language: "en",
        enabled: true
      },
      {
        id: "every",
        name: "Every",
        url: "https://every.to/",
        language: "en",
        enabled: true
      },
      {
        id: "farnam-street",
        name: "Farnam Street",
        url: "https://fs.blog/",
        language: "en",
        enabled: true
      }
    ]
  },
  {
    id: "code",
    name: "Code",
    description: "Engineering blogs, platform updates and developer references.",
    enabled: true,
    sources: [
      {
        id: "github-trending",
        name: "GitHub Trending",
        url: "https://github.com/trending",
        language: "en",
        enabled: true
      },
      {
        id: "spring-blog",
        name: "Spring Blog",
        url: "https://spring.io/blog",
        language: "en",
        enabled: true
      },
      {
        id: "martin-fowler",
        name: "Martin Fowler",
        url: "https://martinfowler.com/",
        language: "en",
        enabled: true
      },
      {
        id: "infoq-java",
        name: "InfoQ Java",
        url: "https://www.infoq.com/java/",
        language: "en",
        enabled: false
      }
    ]
  },
  {
    id: "english",
    name: "English",
    description: "English learning, language notes and writing resources.",
    enabled: true,
    sources: [
      {
        id: "bbc",
        name: "BBC",
        url: "https://www.bbc.co.uk/",
        language: "en",
        enabled: true
      },
      {
        id: "bbc-learning-english",
        name: "BBC Learning English",
        url: "https://www.bbc.co.uk/learningenglish/",
        language: "en",
        enabled: false
      },
      {
        id: "bbc-world",
        name: "BBC World",
        url: "https://www.bbc.com/news/world",
        language: "en",
        enabled: false
      },
      {
        id: "aeon",
        name: "Aeon",
        url: "https://aeon.co/",
        language: "en",
        enabled: true
      },
      {
        id: "the-economist",
        name: "The Economist",
        url: "https://www.economist.com/the-world-this-week",
        language: "en",
        enabled: true
      }
    ]
  }
];
