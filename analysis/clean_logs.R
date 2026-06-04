# read file
lines <- readLines("../log_1.txt")

# keep only snapshot lines
snapshot_lines <- grep("snapshot\\[", lines, value = TRUE)

# extract step numbers
steps <- as.integer(sub(".*snapshot\\[\\s*([0-9]+)\\].*", "\\1", snapshot_lines))

# extract dictionary content (inside { ... })
dict_strings <- sub(".*\\{(.*)\\}.*", "\\1", snapshot_lines)

# function to parse key-value pairs
parse_dict <- function(x) {
  parts <- strsplit(x, ", ")[[1]]
  kv <- lapply(parts, function(p) {
    kvp <- strsplit(p, ": ")[[1]]
    value <- as.numeric(kvp[2])
    setNames(value, kvp[1])
  })
  as.list(do.call(c, kv))
}

# apply parser
parsed <- lapply(dict_strings, parse_dict)

# convert to data frame
df <- do.call(rbind, lapply(parsed, as.data.frame))

# add step column
df <- cbind(step = steps, df)

# write CSV
write.csv(df, "log_1.csv", row.names = FALSE)

print("Saved to snapshots.csv")