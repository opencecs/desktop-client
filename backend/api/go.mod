module device-control-center/backend/api

go 1.26.0

require (
	github.com/gin-gonic/gin v1.11.0
	golang.org/x/crypto v0.49.0
)

require golang.org/x/sys v0.42.0 // indirect

replace github.com/gin-gonic/gin => ./third_party/gin
