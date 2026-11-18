import unittest

from drive_host_3d import camera_path, host_screen, host_view, look_request, two_d_view


class CameraPath(unittest.TestCase):
    def test_every_move_goes_somewhere_new(self):
        path = camera_path(12)
        self.assertEqual(len(path), 12)
        positions = [tuple(round(v, 6) for v in camera["position"]) for camera in path]
        for before, after in zip(positions, positions[1:]):
            self.assertNotEqual(before, after)

    def test_it_never_sits_at_the_same_height_twice_running(self):
        heights = [camera["position"][1] for camera in camera_path(6)]
        for before, after in zip(heights, heights[1:]):
            self.assertNotEqual(before, after)

    def test_each_looks_at_the_middle_of_the_block(self):
        for camera in camera_path(4):
            self.assertEqual(camera["target"], [0, 0, 0])


class HostView(unittest.TestCase):
    def test_the_middle_of_the_slide_on_its_slice_with_the_camera(self):
        camera = camera_path(1)[0]
        seen = host_view((0.0, 2000.0, -1000.0, 0.0), 7, camera)
        self.assertEqual(seen["center"], [1000.0, -500.0])
        self.assertEqual(seen["z"], 7)
        self.assertIs(seen["camera"], camera)


class HostScreen(unittest.TestCase):
    def test_3d_with_the_cut_asked_for(self):
        screen = host_screen("x", 0.3)
        self.assertEqual(screen["depth"]["view"], "3d")
        self.assertEqual(screen["depth"]["settings"]["cut"], "x")
        self.assertEqual(screen["depth"]["settings"]["cutPosition"], 0.3)

    def test_no_cut_by_default(self):
        self.assertEqual(host_screen()["depth"]["settings"]["cut"], "none")


class Look(unittest.TestCase):
    def test_a_look_is_the_view_and_the_spot(self):
        view = host_view((0.0, 2000.0, -1000.0, 0.0), 3, camera_path(1)[0])
        look = look_request(view, (0.1, -0.2, 0.3))
        self.assertEqual(look["point"], [0.1, -0.2, 0.3])
        self.assertEqual(look["camera"], view["camera"])
        self.assertEqual(look["z"], 3)
        self.assertNotIn("point", view)


class TwoD(unittest.TestCase):
    def test_in_2d_on_the_slice_with_no_camera(self):
        seen = two_d_view((0.0, 2000.0, -1000.0, 0.0), 5)
        self.assertEqual(seen["z"], 5)
        self.assertIsNone(seen["camera"])
        self.assertEqual(seen["center"], [500.0, -750.0])


if __name__ == "__main__":
    unittest.main()
