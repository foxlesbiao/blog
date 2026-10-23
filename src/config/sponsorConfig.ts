import type { SponsorConfig } from "../types/sponsorConfig";

export const sponsorConfig: SponsorConfig = {
	// 页面标题，如果留空则使用 i18n 中的翻译
	title: "",

	// 页面描述文本，如果留空则使用 i18n 中的翻译
	description: "",

	// 打赏用途说明
	usage:
		"如果内容帮到了你，欢迎请我喝杯咖啡 ☕",

	// 是否显示打赏者列表
	showSponsorsList: true,

	// 是否显示评论区，需要先在commentConfig.ts启用评论系统
	showComment: true,

	// 是否在文章详情页底部显示打赏按钮
	showButtonInPost: true,

	// 打赏方式列表
	methods: [
		{
			name: "支付宝",
			icon: "fa7-brands:alipay",
			qrCode: "",
			link: "",
			description: "使用 支付宝 扫码打赏",
			enabled: false,
		},
		{
			name: "微信",
			icon: "fa7-brands:weixin",
			qrCode: "",
			link: "",
			description: "使用 微信 扫码打赏",
			enabled: false,
		},
		{
			name: "ko-fi",
			icon: "simple-icons:kofi",
			qrCode: "",
			link: "https://github.com/foxlesbiao",
			description: "Buy me a coffee",
			enabled: true,
		},
		{
			name: "爱发电",
			icon: "simple-icons:afdian",
			qrCode: "",
			link: "https://ifdian.net/a/foxlesbiao",
			description: "通过 爱发电 支持我",
			enabled: true,
		},
	],

	// 打赏者列表（可选）
	sponsors: [
		// 示例：已实名打赏者
		{
			name: "夏叶",
			avatar:
				"https://weavatar.com/avatar/d252655d40d6874417a720bad0a6c5f77f8f6a1fd2f882f8f338402dc37e4190?s=640",
			amount: "¥50",
			date: "2025-10-01",
		},

		// 示例：匿名打赏者
		{
			name: "匿名用户",
			// avatar: "",
			amount: "¥20",
			date: "2025-10-01",
		},
	],
};
