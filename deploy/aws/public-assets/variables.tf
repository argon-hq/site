variable "env" {
  description = "Environment whose prefix receives the files."
  type        = string

  validation {
    condition     = contains(["lab", "dev", "prod"], var.env)
    error_message = "env must be lab, dev or prod."
  }
}

variable "region" {
  description = "Region of the public bucket."
  type        = string
  default     = "sa-east-1"
}

variable "bucket" {
  description = "Public bucket, created by the root one level up (output public_bucket)."
  type        = string
  default     = "argon-public-382597877834"
}

variable "public_dir" {
  description = "Folder published as is. The lab deploy of another branch points it at that checkout."
  type        = string
  default     = ""
}
