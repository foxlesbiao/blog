import type { FontDefinition, FontSelectionConfig } from "@/types/fontConfig";

export const fontsList: FontDefinition[] = [];

export const fontConfig: FontSelectionConfig = {
	enable: false,
	selected: ["system"],
	bannerTitleFont: "",
	bannerSubtitleFont: "",
	navbarTitleFont: "",
	codeFont: "",
	subsetFonts: {},
};