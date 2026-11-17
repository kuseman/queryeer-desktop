package com.queryeer.backend.queryengine.jdbc.setup;

/** The type of a connection form field; Queryeer's settings editor renders a control for each. */
public enum JdbcConnectionFieldType
{
    TEXT,
    NUMBER,
    /** Stored as the connection's password, a reference into the security vault, not in its properties. */
    SECRET,
    BOOLEAN,
    /** One of the field's options. */
    SELECT,
    /** A folder, with a browse button that picks a folder. */
    FOLDER_PATH,
    /** A file, with a browse button that picks a file. */
    FILE_PATH
}
