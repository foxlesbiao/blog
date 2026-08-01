import type { SiteConfig } from "@/types/siteConfig";

const SITE_LANG = "zh_CN";

export const siteConfig: SiteConfig = {
	title: "Illya·Lily·Iris·Alice",
	subtitle: "修车、折腾、写代码",
	site_url: "https://foxlesbiao.github.io/blog",
	description: "电动摩托车售后技术支持 / 自托管NAS / AI Agent / Linux运维 / DIY硬件折腾 / 电摩改装 / 阳台光伏",
	keywords: ["Illya", "Hermes Agent", "OpenViking", "NAS", "飞牛OS", "Armbian", "Docker", "自托管", "AI Agent", "电摩改装", "光伏", "ESP32", "OpenWrt", "Linux运维"],
	themeColor: {
		hue: 165,
		defaultMode: "system",
	},
	pageWidth: 100,
	card: {
		border: true,
		followTheme: false,
	},
	favicon: [
		{ src: "/favicon/favicon-192.png", sizes: "192x192", type: "image/png" },
		{ src: "/favicon/favicon-32.png", sizes: "32x32", type: "image/png" },
		{ src: "/favicon/favicon-16.png", sizes: "16x16", type: "image/png" },
		{ src: "/favicon/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
	],
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
		generateOgImages: true,
	},
	bangumi: { userId: "", mode: "dynamic", apiUrl: "https://bgmapi.anibt.net", subjectBaseUrl: "https://bgmmi.anibt.net/subject/", categoryOrder: ["anime", "book", "music", "game"] },
	anime: { bilibili: { uid: "" } },
	pagination: { postsPerPage: 10 },
	imageOptimization: { formats: "webp", quality: 85, noReferrerDomains: ["*.hdslb.com", "*.bilibili.com"] },
	lang: SITE_LANG,
};