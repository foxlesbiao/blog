import type { ProfileConfig } from "../types/profileConfig";

export const profileConfig: ProfileConfig = {
	avatar: "/avatar.jpg",
	name: "Illya-Lily-Iris·Alice",
	bio: "在数字与现实之间反复横跳",
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