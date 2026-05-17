// In its own file to avoid circular dependencies
export const FILE_EDIT_TOOL_NAME = 'Edit'

// Permission pattern for granting session-level access to the project's .ahcode/ folder
export const AHCODE_FOLDER_PERMISSION_PATTERN = '/.ahcode/**'

// Permission pattern for granting session-level access to the global ~/.ahcode/ folder
export const GLOBAL_AHCODE_FOLDER_PERMISSION_PATTERN = '~/.ahcode/**'

export const FILE_UNEXPECTEDLY_MODIFIED_ERROR =
  'File has been unexpectedly modified. Read it again before attempting to write it.'
