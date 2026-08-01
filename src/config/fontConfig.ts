import type { FontDefinition, FontSelectionConfig } from "@/types/fontConfig";

export const fontsList: FontDefinition[] = [
	{
		name: "JetBrains Mono",
		cssVariable: "--font-jetbrains-mono",
		provider: "fontsource",
		weights: ["400", "700"],
		styles: ["normal"],
		subsets: ["latin", "cyrillic"],
		fallbacks: [
			"ui-monospace",
			"SFMono-Regular",
			"Menlo",
			"Monaco",
			"Consolas",
			"Liberation Mono",
			"Courier New",
			"monospace",
		],
	},
];

export const fontConfig: FontSelectionConfig = {
	enable: true,
	selected: ["system"],
	bannerTitleFont: "",
	bannerSubtitleFont: "",
	navbarTitleFont: "",
	codeFont: "--font-jetbrains-mono",
	subsetFonts: {},
};