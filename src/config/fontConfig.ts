import type { FontDefinition, FontSelectionConfig } from "@/types/fontConfig";

export const fontsList: FontDefinition[] = [
	{
		name: "MiSans",
		cssVariable: "--font-misans",
		provider: "local",
		weights: ["300", "350", "400", "500", "600", "700"],
		styles: ["normal"],
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