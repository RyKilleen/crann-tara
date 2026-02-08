serve:
	npx http-server -p 8000

tunnel:
	npx localtunnel --port 8000

all:
	$(MAKE) serve &
	$(MAKE) tunnel
