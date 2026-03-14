using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Text;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;

namespace AutoCompOCR
{
    class Program
    {
        [STAThread]
        static async Task Main(string[] args)
        {
            try
            {
                bool isConcentrationMode = args.Contains("--concentration");
                Rectangle? cropRect = null;

                int cropIdx = Array.IndexOf(args, "--crop");
                if (cropIdx != -1 && cropIdx + 1 < args.Length)
                {
                    var parts = args[cropIdx + 1].Split(',');
                    if (parts.Length == 4)
                    {
                        cropRect = new Rectangle(
                            int.Parse(parts[0]), int.Parse(parts[1]),
                            int.Parse(parts[2]), int.Parse(parts[3])
                        );
                    }
                }

                await PerformOCR(isConcentrationMode, cropRect);
            }
            catch (Exception ex)
            {
                // エラー時は空の結果を返す
                Console.WriteLine("{\"results\":[]}");
            }
        }

        static async Task PerformOCR(bool isConcentrationMode, Rectangle? cropRect)
        {
            // 1. スクリーンキャプチャ
            Bitmap bitmap;
            if (cropRect.HasValue)
            {
                bitmap = new Bitmap(cropRect.Value.Width, cropRect.Value.Height);
                using (Graphics g = Graphics.FromImage(bitmap))
                {
                    g.CopyFromScreen(cropRect.Value.Left, cropRect.Value.Top, 0, 0, cropRect.Value.Size);
                }
            }
            else
            {
                var screen = System.Windows.Forms.Screen.PrimaryScreen.Bounds;
                bitmap = new Bitmap(screen.Width, screen.Height);
                using (Graphics g = Graphics.FromImage(bitmap))
                {
                    g.CopyFromScreen(0, 0, 0, 0, screen.Size);
                }
            }

            // 2. Windows OCR に渡すためにストリーム変換
            using (var stream = new MemoryStream())
            {
                bitmap.Save(stream, ImageFormat.Png);
                stream.Position = 0;

                var decoder = await BitmapDecoder.CreateAsync(stream.AsRandomAccessStream());
                var softwareBitmap = await decoder.GetSoftwareBitmapAsync();

                var engine = OcrEngine.TryCreateFromLanguage(new Windows.Globalization.Language("ja-JP")) 
                             ?? OcrEngine.TryCreateFromLanguage(new Windows.Globalization.Language("en-US"));
                
                if (engine == null)
                {
                    Console.WriteLine("{\"results\":[]}");
                    return;
                }

                var result = await engine.RecognizeAsync(softwareBitmap);
                
                StringBuilder json = new StringBuilder();
                json.Append("{\"results\":[");

                bool first = true;
                foreach (var line in result.Lines)
                {
                    string text = line.Text.Trim()
                        .Replace("\\", "\\\\").Replace("\"", "\\\"");
                    
                    if (text.Length < 2) continue;
                    
                    if (!first) json.Append(",");
                    
                    var firstWord = line.Words[0];
                    var rect = firstWord.BoundingRect;

                    json.Append("{");
                    json.AppendFormat("\"text\":\"{0}\",", text);
                    json.AppendFormat("\"x\":{0},", (int)rect.X);
                    json.AppendFormat("\"y\":{0},", (int)rect.Y);
                    json.AppendFormat("\"width\":{0},", (int)rect.Width);
                    json.AppendFormat("\"height\":{0}", (int)rect.Height);
                    json.Append("}");
                    
                    first = false;
                }

                json.Append("]}");
                Console.WriteLine(json.ToString());
            }
        }
    }
}
