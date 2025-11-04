import SwiftUI

struct PulsingMarkerView: View {
    @State private var animate = false

    var body: some View {
        ZStack {
            // --- 波動（ここは同じ） ---
            Circle()
                .stroke(Color.blue.opacity(0.8), lineWidth: 2)
                .frame(width: 40, height: 40)
                .scaleEffect(animate ? 1.0 : 0.0)
                .opacity(animate ? 0.0 : 1.0)
                .animation(
                    Animation.easeOut(duration: 1.5).repeatForever(autoreverses: false),
                    value: animate
                )
            
            Circle()
                .stroke(Color.blue.opacity(0.8), lineWidth: 2)
                .frame(width: 40, height: 40)
                .scaleEffect(animate ? 1.0 : 0.0)
                .opacity(animate ? 0.0 : 1.0)
                .animation(
                    Animation.easeOut(duration: 1.5).repeatForever(autoreverses: false).delay(0.75),
                    value: animate
                )

            // --- 中心のマーカー ---
            // ここのコードを、現在使っている「矢印」のViewに置き換えてください
            Image(systemName: "location.north.fill") // ← 例です
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: 20, height: 20) // サイズは適宜調整してください
                .foregroundColor(.blue)
                .padding(6)
                .background(Color.white)
                .clipShape(Circle())
                .shadow(radius: 3)
            // ------------------------

        }
        .onAppear {
            self.animate = true
        }
    }
}
