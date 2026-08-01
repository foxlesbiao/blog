import type { FontDefinition, FontSelectionConfig } from "@/types/fontConfig";

export const fontsList: FontDefinition[] = [
	{
		name: "MiSans",
		cssVariable: "--font-misans",
		provider: "local",
		options: {
			variants: [
				{
					src: ["./public/assets/fonts/misans/MiSans-Light.woff2"],
					weight: "300",
					style: "normal",
				},
				{
					src: ["./public/assets/fonts/misans/MiSans-Normal.woff2"],
					weight: "350",
					style: "normal",
				},
				{
					src: ["./public/assets/fonts/misans/MiSans-Regular.woff2"],
					weight: "400",
					style: "normal",
				},
				{
					src: ["./public/assets/fonts/misans/MiSans-Medium.woff2"],
					weight: "500",
					style: "normal",
				},
				{
					src: ["./public/assets/fonts/misans/MiSans-Semibold.woff2"],
					weight: "600",
					style: "normal",
				},
				{
					src: ["./public/assets/fonts/misans/MiSans-Bold.woff2"],
					weight: "700",
					style: "normal",
				},
			],
		},
		fallbacks: ["sans-serif"],
	},
];

export const fontConfig: FontSelectionConfig = {
	enable: true,
	selected: ["--font-misans"],
	bannerTitleFont: "--font-misans",
	bannerSubtitleFont: "--font-misans",
	navbarTitleFont: "",
	codeFont: "",
	subsetFonts: {},
};