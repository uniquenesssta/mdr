// Test-only child lifecycle for the owned Windows Node HTTPS server.
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Child, Command, Stdio};

pub struct OwnedTlsServer {
    child: Child,
    pub url: String,
}

impl OwnedTlsServer {
    pub fn start() -> Self {
        let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/e2e/windows/dependency-tls-server.mjs");
        let child = Command::new("node")
            .arg(script)
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .expect("start owned Windows TLS server");
        let mut server = Self {
            child,
            url: String::new(),
        };
        let mut line = String::new();
        BufReader::new(server.child.stdout.take().expect("server port pipe"))
            .read_line(&mut line)
            .expect("read owned server port");
        let port: u16 = line.trim().parse().expect("valid owned server port");
        server.url = format!("https://127.0.0.1:{port}/owned");
        server
    }
}

impl Drop for OwnedTlsServer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
