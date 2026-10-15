/** Whether the signed-in person works in the head office company. Set once when the app loads. */
let ho = false;
export const setHeadOffice = (v: boolean) => { ho = v; };
export const isHeadOffice = () => ho;

/** The link to the other country's app, shown only to the head office. Set once when the app loads. */
let sw: { toCountry: 'CA' | 'US'; url: string } | null = null;
export const setCountrySwitch = (v: { toCountry: 'CA' | 'US'; url: string } | null) => { sw = v; };
export const countrySwitch = () => sw;
