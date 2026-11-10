// Sub-sheet file names as the Studio shows them: `PowerStage.sheet.tsx` is the sheet "PowerStage".

const SHEET_FILE = /\.sheet\.tsx$/

/** Whether a project file is a sub-sheet file. */
export const isSheetFile = (file: string | undefined): boolean => file !== undefined && SHEET_FILE.test(file)

/** The sheet's name: its file name without the folder and ".sheet.tsx". */
export const sheetName = (file: string): string => (file.split("/").pop() ?? file).replace(SHEET_FILE, "")
