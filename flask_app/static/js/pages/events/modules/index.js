/* Events — module registry. Two renderers per type:
     render(root, ctx)        — view mode: content + interaction
     renderSettings(root, ctx)— edit mode: host config cards (§1)
   Members is FIXED: always present, not draggable/removable; its host
   control (add members + invite link) is an edit-mode card. */
import { renderDescription } from "./description.js";
import { renderLocation } from "./location.js";
import { renderMembers } from "./members.js";
import { renderDoodle } from "./doodle.js";
import { renderBring } from "./bring.js";
import { renderRides } from "./rides.js";
import { renderChat } from "./chat.js";
import {
    settingsDescription, settingsImage, settingsLocation, settingsDoodle,
    settingsBring, settingsChat, settingsTitle, settingsRides,
    settingsMembers,
} from "./settings.js";

/* View-mode meta: the custom events icon set (ui.js evIcon). Edit mode
   keeps the generic tabler icons — cards + grip are the editor's language. */
export const MODULE_META = {
    title:       { label: "Title & date", icon: "calendar", fixed: true },
    members:     { label: "Members",      icon: "users",    fixed: true },
    description: { label: "Description",  icon: "file" },
    image:       { label: "Image",        icon: "upload" },
    location:    { label: "Location",     icon: "map-pin" },
    doodle:      { label: "Dates (Doodle)", icon: "calendar" },
    bring:       { label: "Bring list",   icon: "package" },
    rides:       { label: "Car share",    icon: "heart" },
    chat:        { label: "Chat",         icon: "message" },
};

export const MODULES = {
    title:       { settings: settingsTitle },
    description: { render: renderDescription, settings: settingsDescription },
    image:       { settings: settingsImage },
    location:    { render: renderLocation, settings: settingsLocation },
    members:     { render: renderMembers, settings: settingsMembers },
    doodle:      { render: renderDoodle, settings: settingsDoodle },
    bring:       { render: renderBring, settings: settingsBring },
    rides:       { render: renderRides, settings: settingsRides },
    chat:        { render: renderChat, settings: settingsChat },
};
