import { Encoder, Profile } from "@garmin/fitsdk";

type Mesg = [number, Record<string, unknown>];

/** A FIT file built in the test: no real files, they hold GPS data. */
export function fitFile(...mesgs: Mesg[]): Uint8Array {
  const fileId: Mesg = [
    Profile.MesgNum.FILE_ID,
    { manufacturer: "development", product: 1, timeCreated: new Date(0), type: "activity" },
  ];
  const encoder = new Encoder();
  for (const [num, mesg] of [fileId, ...mesgs]) encoder.onMesg(num, mesg);
  return encoder.close();
}
