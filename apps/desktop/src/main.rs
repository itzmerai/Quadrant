// Windows release builds should not spawn a console window alongside the app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    quadrant_lib::run()
}
