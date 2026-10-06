/** Whether the signed-in person works in the head office company. Set once when the app loads. */
let ho = false;
export const setHeadOffice = (v: boolean) => { ho = v; };
export const isHeadOffice = () => ho;
