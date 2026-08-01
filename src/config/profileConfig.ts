import type { ProfileConfig } from "../types/profileConfig";

export const profileConfig: ProfileConfig = {
	avatar: "",
	name: "foxlesbiao",
	bio: "技术笔记与踩坑记录",
	links: [
		{
			name: "GitHub",
			icon: "fa7-brands:github",
			url: "https://github.com/foxlesbiao",
			showName: false,
		},
		{
			name: "RSS",
			icon: "fa7-solid:rss",
			url: "/blog/rss/",
			showName: false,
		},
	],
};