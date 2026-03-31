package gin

import (
	"encoding/json"
	"log"
	"net/http"
	"path"
	"strings"
	"time"
)

type H map[string]any

type HandlerFunc func(*Context)

type Engine struct {
	routes             []route
	middlewares        []HandlerFunc
	MaxMultipartMemory int64
}

type RouterGroup struct {
	engine      *Engine
	prefix      string
	middlewares []HandlerFunc
}

type route struct {
	method   string
	pattern  string
	segments []segment
	handlers []HandlerFunc
}

type segment struct {
	literal string
	param   string
	wildcard bool
}

type Context struct {
	Writer     http.ResponseWriter
	Request    *http.Request
	Params     map[string]string
	Keys       map[string]any
	handlers   []HandlerFunc
	index      int
	aborted    bool
	statusCode int
}

func New() *Engine {
	return &Engine{routes: make([]route, 0, 16), middlewares: make([]HandlerFunc, 0, 4)}
}

func (e *Engine) Use(middleware ...HandlerFunc) {
	e.middlewares = append(e.middlewares, middleware...)
}

func (e *Engine) Group(relativePath string) *RouterGroup {
	return &RouterGroup{
		engine:      e,
		prefix:      cleanPath(relativePath),
		middlewares: make([]HandlerFunc, 0, 4),
	}
}

func (e *Engine) GET(relativePath string, handlers ...HandlerFunc) {
	e.addRoute(http.MethodGet, relativePath, handlers...)
}

func (e *Engine) POST(relativePath string, handlers ...HandlerFunc) {
	e.addRoute(http.MethodPost, relativePath, handlers...)
}

func (e *Engine) PUT(relativePath string, handlers ...HandlerFunc) {
	e.addRoute(http.MethodPut, relativePath, handlers...)
}

func (e *Engine) PATCH(relativePath string, handlers ...HandlerFunc) {
	e.addRoute(http.MethodPatch, relativePath, handlers...)
}

func (e *Engine) DELETE(relativePath string, handlers ...HandlerFunc) {
	e.addRoute(http.MethodDelete, relativePath, handlers...)
}

func (e *Engine) HEAD(relativePath string, handlers ...HandlerFunc) {
	e.addRoute(http.MethodHead, relativePath, handlers...)
}

func (e *Engine) addRoute(method, relativePath string, handlers ...HandlerFunc) {
	e.routes = append(e.routes, route{
		method:   method,
		pattern:  cleanPath(relativePath),
		segments: splitSegments(cleanPath(relativePath)),
		handlers: append([]HandlerFunc{}, handlers...),
	})
}

func (g *RouterGroup) Use(middleware ...HandlerFunc) {
	g.middlewares = append(g.middlewares, middleware...)
}

func (g *RouterGroup) Group(relativePath string) *RouterGroup {
	return &RouterGroup{
		engine:      g.engine,
		prefix:      joinPaths(g.prefix, relativePath),
		middlewares: append([]HandlerFunc{}, g.middlewares...),
	}
}

func (g *RouterGroup) GET(relativePath string, handlers ...HandlerFunc) {
	g.handle(http.MethodGet, relativePath, handlers...)
}

func (g *RouterGroup) POST(relativePath string, handlers ...HandlerFunc) {
	g.handle(http.MethodPost, relativePath, handlers...)
}

func (g *RouterGroup) PUT(relativePath string, handlers ...HandlerFunc) {
	g.handle(http.MethodPut, relativePath, handlers...)
}

func (g *RouterGroup) PATCH(relativePath string, handlers ...HandlerFunc) {
	g.handle(http.MethodPatch, relativePath, handlers...)
}

func (g *RouterGroup) DELETE(relativePath string, handlers ...HandlerFunc) {
	g.handle(http.MethodDelete, relativePath, handlers...)
}

func (g *RouterGroup) HEAD(relativePath string, handlers ...HandlerFunc) {
	g.handle(http.MethodHead, relativePath, handlers...)
}

func (g *RouterGroup) handle(method, relativePath string, handlers ...HandlerFunc) {
	combined := append([]HandlerFunc{}, g.middlewares...)
	combined = append(combined, handlers...)
	g.engine.addRoute(method, joinPaths(g.prefix, relativePath), combined...)
}

func (e *Engine) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	route, params := e.match(r.Method, cleanPath(r.URL.Path))

	// 构建处理链：引擎级中间件 + 路由处理器
	handlers := append([]HandlerFunc{}, e.middlewares...)

	if route != nil {
		handlers = append(handlers, route.handlers...)
	} else {
		// 路由未匹配时，中间件仍需执行（如 CORS 处理 OPTIONS 预检）
		// 中间件执行完毕后返回 404
		handlers = append(handlers, func(c *Context) {
			writeJSON(c.Writer, http.StatusNotFound, H{"message": "not found"})
		})
	}

	ctx := &Context{
		Writer:   w,
		Request:  r,
		Params:   params,
		Keys:     map[string]any{},
		handlers: handlers,
		index:    -1,
	}
	if params == nil {
		ctx.Params = map[string]string{}
	}
	ctx.Next()
}

func (e *Engine) match(method, requestPath string) (*route, map[string]string) {
	for i := range e.routes {
		rt := &e.routes[i]
		if rt.method != method {
			continue
		}
		params, ok := matchSegments(rt.segments, requestPath)
		if ok {
			return rt, params
		}
	}
	return nil, nil
}

func (c *Context) Next() {
	c.index++
	for c.index < len(c.handlers) {
		if c.aborted {
			return
		}
		handler := c.handlers[c.index]
		handler(c)
		c.index++
	}
}

func (c *Context) JSON(status int, obj any) {
	c.statusCode = status
	writeJSON(c.Writer, status, obj)
}

func (c *Context) ShouldBindJSON(obj any) error {
	decoder := json.NewDecoder(c.Request.Body)
	return decoder.Decode(obj)
}

func (c *Context) GetHeader(key string) string {
	return c.Request.Header.Get(key)
}

func (c *Context) Query(key string) string {
	return c.Request.URL.Query().Get(key)
}

func (c *Context) Param(key string) string {
	if c.Params == nil {
		return ""
	}
	return c.Params[key]
}

func (c *Context) AbortWithStatusJSON(status int, obj any) {
	c.aborted = true
	c.JSON(status, obj)
}

func (c *Context) Abort() {
	c.aborted = true
}

func (c *Context) AbortWithStatus(code int) {
	c.Writer.WriteHeader(code)
	c.Abort()
}

func Logger() HandlerFunc {
	return func(c *Context) {
		start := time.Now()
		c.Next()
		status := c.statusCode
		if status == 0 {
			status = http.StatusOK
		}
		log.Printf("%s %s %d %s", c.Request.Method, c.Request.URL.Path, status, time.Since(start).Truncate(time.Millisecond))
	}
}

func Recovery() HandlerFunc {
	return func(c *Context) {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("panic recovered: %v", r)
				c.AbortWithStatusJSON(http.StatusInternalServerError, H{"message": "internal server error"})
			}
		}()
		c.Next()
	}
}

func cleanPath(value string) string {
	if value == "" {
		return "/"
	}
	cleaned := path.Clean("/" + strings.TrimSpace(value))
	if strings.HasSuffix(value, "/") && cleaned != "/" {
		cleaned += "/"
	}
	return cleaned
}

func joinPaths(base, relative string) string {
	base = strings.TrimSuffix(cleanPath(base), "/")
	relative = strings.TrimPrefix(relative, "/")
	if relative == "" {
		return cleanPath(base)
	}
	return cleanPath(base + "/" + relative)
}

func splitSegments(value string) []segment {
	if value == "/" {
		return nil
	}
	trimmed := strings.Trim(value, "/")
	parts := strings.Split(trimmed, "/")
	segments := make([]segment, 0, len(parts))
	for _, part := range parts {
		if strings.HasPrefix(part, ":") {
			segments = append(segments, segment{param: strings.TrimPrefix(part, ":")})
			continue
		}
		if strings.HasPrefix(part, "*") {
			segments = append(segments, segment{wildcard: true, param: strings.TrimPrefix(part, "*")})
			continue
		}
		segments = append(segments, segment{literal: part})
	}
	return segments
}

func matchSegments(routeSegments []segment, requestPath string) (map[string]string, bool) {
	if requestPath == "/" {
		if len(routeSegments) == 0 {
			return map[string]string{}, true
		}
		return nil, false
	}
	parts := strings.Split(strings.Trim(requestPath, "/"), "/")
	params := map[string]string{}
	ri := 0
	for ri < len(routeSegments) {
		if ri >= len(parts) {
			return nil, false
		}
		seg := routeSegments[ri]
		if seg.wildcard {
			params[seg.param] = strings.Join(parts[ri:], "/")
			return params, true
		}
		if seg.param != "" {
			params[seg.param] = parts[ri]
		} else if seg.literal != parts[ri] {
			return nil, false
		}
		ri++
	}
	if ri != len(parts) {
		return nil, false
	}
	return params, true
}

func writeJSON(w http.ResponseWriter, status int, obj any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if obj == nil {
		return
	}
	data, err := json.Marshal(obj)
	if err != nil {
		fallback, _ := json.Marshal(H{"message": err.Error()})
		_, _ = w.Write(fallback)
		return
	}
	_, _ = w.Write(data)
}
