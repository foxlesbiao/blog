import type { SiteConfig } from "@/types/siteConfig";

const SITE_LANG = "zh_CN";

export const siteConfig: SiteConfig = {
	title: "Tech Notes",
	subtitle: "技术笔记与踩坑记录",
	site_url: "https://foxlesbiao.github.io/blog",
	description: "技术笔记与踩坑记录，涵盖 Hermes Agent、NAS 运维、家庭能源系统、系统架构设计等内容。",
	keywords: ["Tech Notes", "Hermes", "博客", "技术博客", "NAS", "能源系统", "静态博客"],
	themeColor: {
		hue: 165,
		defaultMode: "system",
	},
	pageWidth: 100,
	card: {
		border: false,
		followTheme: false,
	},
	favicon: [],
	navbar: {
		logo: {
			type: "icon",
			value: "material-symbols:code-blocks",
			alt: "TN",
		},
		title: "Tech Notes",
		widthFull: false,
		menuAlign: "center",
		followTheme: false,
		stickyNavbar: true,
	},
	siteStartDate: "2025-01-01",
	timezone: "Asia/Shanghai",
	pages: {
		friends: false,
		sponsor: false,
		guestbook: false,
		bangumi: false,
		gallery: false,
		anime: false,
		dynamic: false,
	},
	categoryBar: true,
	foldArticle: true,
	postListLayout: {
		defaultMode: "list",
		mobileDefaultMode: "grid",
		descriptionLines: 2,
		showStatsIcons: true,
		tagsPosition: "bottom",
		meta: { showPublished: true, showCategory: true, showTags: true, tagCount: 5, showWords: false, showReadingTime: false },
		stats: { showPublished: true, showWords: true, showReadingTime: true },
		grid: { masonry: false, columnWidth: 320 },
	},
	post: {
		rehypeCallouts: { theme: "github", enablePythonMarkdownAdmonitions: false },
		showLastModified: true,
		outdatedThreshold: 30,
		sharePoster: true,
		generateOgImages: false,
	},
	bangumi: { userId: "", mode: "dynamic", apiUrl: "https://bgmapi.anibt.net", subjectBaseUrl: "https://bgmmi.anibt.net/subject/", categoryOrder: ["anime", "book", "music", "game"] },
	anime: { bilibili: { uid: "" } },
	pagination: { postsPerPage: 10 },
	imageOptimization: { formats: "webp", quality: 85, noReferrerDomains: ["*.hdslb.com", "*.bilibili.com"] },
	lang: SITE_LANG,
};